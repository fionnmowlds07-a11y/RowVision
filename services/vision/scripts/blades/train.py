"""Train the blade detector with whole clips held out, and report accuracy on unseen clips.

A small U-Net takes a crop of the rower plus a channel marking their hands, and returns a heat map
of where the blade is and whether it is in the water. Needs PyTorch, which the engine does not.

    python train.py [epochs]                     five folds, whole clips held out, to cv.json
    python train.py [epochs] NAME [clip,clip]    train on the rest and export NAME.onnx
"""

import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

PRIVATE = Path("/private/train")
WIDTH, HEIGHT = 256, 128
STRIDE = 2
"""The heat map is half the crop's size."""
SPOT_SIGMA = 3.0
HANDS_SIGMA = 6
BATCH = 16
FOLDS = 5

torch.set_num_threads(4)
torch.manual_seed(0)
rng = np.random.default_rng(0)

data = np.load(PRIVATE / "crops.npz")
img, blade, state, hands, clip = (data[k] for k in ("img", "blade", "state", "hands", "clip"))
heat_y, heat_x = np.mgrid[0 : HEIGHT // STRIDE, 0 : WIDTH // STRIDE].astype(np.float32)
crop_y, crop_x = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)


def spot(point: np.ndarray, x: np.ndarray, y: np.ndarray, sigma: float) -> np.ndarray:
    return np.exp(-((x - point[0]) ** 2 + (y - point[1]) ** 2) / (2 * sigma * sigma)).astype(
        np.float32
    )


def augment(
    image: np.ndarray, blade_at: np.ndarray, hands_at: np.ndarray, seen: bool
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Shift, scale, recolour, blur and add noise, moving the labels with the picture."""
    scale = rng.uniform(0.85, 1.2)
    shift_x, shift_y = rng.uniform(-18, 18), rng.uniform(-10, 10)
    matrix = np.array(
        [
            [scale, 0, WIDTH / 2 * (1 - scale) + shift_x],
            [0, scale, HEIGHT / 2 * (1 - scale) + shift_y],
        ],
        np.float32,
    )
    image = cv2.warpAffine(image, matrix, (WIDTH, HEIGHT), borderMode=cv2.BORDER_REPLICATE)
    if seen:
        blade_at = matrix @ np.array([blade_at[0], blade_at[1], 1], np.float32)
    if hands_at[0] >= 0:
        hands_at = matrix @ np.array([hands_at[0], hands_at[1], 1], np.float32)
    image = np.clip(image * rng.uniform(0.7, 1.3) + rng.uniform(-0.1, 0.1), 0, 1)
    image = np.clip(image * rng.uniform(0.85, 1.15, 3).astype(np.float32), 0, 1)
    if rng.random() < 0.5:
        size = int(rng.choice([3, 5]))
        image = cv2.GaussianBlur(image, (size, size), 0)
    image = np.clip(image + rng.normal(0, 0.015, image.shape).astype(np.float32), 0, 1)
    return image, blade_at, hands_at


def sample(i: int, train: bool) -> tuple[np.ndarray, np.ndarray, float]:
    """Return the network input, the target heat map and whether the blade is in the water."""
    image = img[i].astype(np.float32) / 255
    blade_at, hands_at = blade[i].copy(), hands[i].copy()
    if train:
        image, blade_at, hands_at = augment(image, blade_at, hands_at, state[i] < 2)
    hands_map = (
        spot(hands_at, crop_x, crop_y, HANDS_SIGMA)
        if hands_at[0] >= 0
        else np.zeros((HEIGHT, WIDTH), np.float32)
    )
    x = np.concatenate([image.transpose(2, 0, 1), hands_map[None]], 0)
    inside = state[i] < 2 and 0 <= blade_at[0] < WIDTH and 0 <= blade_at[1] < HEIGHT
    target = (
        spot(blade_at / STRIDE, heat_x, heat_y, SPOT_SIGMA)
        if inside
        else np.zeros((HEIGHT // STRIDE, WIDTH // STRIDE), np.float32)
    )
    return x, target[None], float(state[i] == 1)


class Block(nn.Module):
    def __init__(self, inputs: int, outputs: int) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv2d(inputs, outputs, 3, padding=1, bias=False),
            nn.BatchNorm2d(outputs),
            nn.ReLU(inplace=True),
            nn.Conv2d(outputs, outputs, 3, padding=1, bias=False),
            nn.BatchNorm2d(outputs),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.layers(x)


class Net(nn.Module):
    """A small U-Net with a heat map head and an attention-pooled in-the-water head."""

    def __init__(self, c: int = 16) -> None:
        super().__init__()
        self.e1, self.e2 = Block(4, c), Block(c, c * 2)
        self.e3, self.e4 = Block(c * 2, c * 4), Block(c * 4, c * 8)
        self.middle = Block(c * 8, c * 8)
        self.d3, self.d2, self.d1 = Block(c * 16, c * 4), Block(c * 8, c * 2), Block(c * 4, c * 2)
        self.heat = nn.Conv2d(c * 2, 1, 1)
        self.water = nn.Linear(c * 2, 1)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        def up(t: torch.Tensor) -> torch.Tensor:
            return F.interpolate(t, scale_factor=2, mode="bilinear", align_corners=False)

        a = self.e1(x)
        b = self.e2(F.max_pool2d(a, 2))
        c = self.e3(F.max_pool2d(b, 2))
        d = self.e4(F.max_pool2d(c, 2))
        m = self.middle(F.max_pool2d(d, 2))
        y = self.d3(torch.cat([up(m), d], 1))
        y = self.d2(torch.cat([up(y), c], 1))
        y = self.d1(torch.cat([up(y), b], 1))
        logit = self.heat(y)
        attention = torch.sigmoid(logit)
        pooled = (y * attention).sum((2, 3)) / (attention.sum((2, 3)) + 1e-3)
        return logit, self.water(pooled)


def fit(indices: np.ndarray, epochs: int) -> Net:
    net = Net()
    optimiser = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-3)
    schedule = torch.optim.lr_scheduler.OneCycleLR(
        optimiser, 3e-3, total_steps=epochs * math.ceil(len(indices) / BATCH)
    )
    for epoch in range(epochs):
        net.train()
        order = rng.permutation(indices)
        total = 0.0
        for start in range(0, len(order), BATCH):
            batch = [sample(i, True) for i in order[start : start + BATCH]]
            x = torch.tensor(np.stack([b[0] for b in batch]))
            target = torch.tensor(np.stack([b[1] for b in batch]))
            water = torch.tensor([b[2] for b in batch])
            logit, water_logit = net(x)
            loss = F.binary_cross_entropy_with_logits(
                logit, target, pos_weight=torch.tensor(20.0)
            ) + 0.2 * F.binary_cross_entropy_with_logits(water_logit[:, 0], water)
            optimiser.zero_grad()
            loss.backward()
            optimiser.step()
            schedule.step()
            total += loss.item() * len(batch)
        if (epoch + 1) % 10 == 0:
            print("  epoch", epoch + 1, round(total / len(order), 3), flush=True)
    return net.eval()


@torch.no_grad()
def predict(net: Net, i: int) -> tuple[tuple[float, float], float, float]:
    """Return the blade position in the crop, the peak heat and the chance it is in the water."""
    x, _, _ = sample(i, False)
    logit, water_logit = net(torch.tensor(x[None]))
    heat = torch.sigmoid(logit)[0, 0].numpy()
    y, x_at = np.unravel_index(heat.argmax(), heat.shape)
    position = (float(x_at * STRIDE + STRIDE / 2), float(y * STRIDE + STRIDE / 2))
    return position, float(heat.max()), float(torch.sigmoid(water_logit)[0, 0])


class Exported(nn.Module):
    def __init__(self, net: Net) -> None:
        super().__init__()
        self.net = net

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        logit, water = self.net(x)
        return torch.sigmoid(logit), torch.sigmoid(water)


def train_and_export(name: str, held_out: list[str], epochs: int) -> None:
    train = np.array([i for i in range(len(clip)) if not any(h in str(clip[i]) for h in held_out)])
    print(name, "training on", len(train), "held out", held_out, flush=True)
    net = fit(train, epochs)
    torch.save(net.state_dict(), PRIVATE / f"{name}.pth")
    torch.onnx.export(
        Exported(net),
        torch.zeros(1, 4, HEIGHT, WIDTH),
        PRIVATE / f"{name}.onnx",
        input_names=["image"],
        output_names=["heat", "water"],
        dynamic_axes={"image": {0: "n"}, "heat": {0: "n"}, "water": {0: "n"}},
        opset_version=17,
        dynamo=False,
    )
    print("saved", flush=True)


def cross_validate(epochs: int) -> None:
    """Split whole clips into folds of similar size, so no clip is both trained and tested on."""
    clips = sorted(set(clip))
    sizes = {c: int((clip == c).sum()) for c in clips}
    folds: list[list[str]] = [[] for _ in range(FOLDS)]
    for c in sorted(clips, key=lambda c: -sizes[c]):
        min(folds, key=lambda f: sum(sizes[x] for x in f)).append(c)
    results = []
    for n, fold in enumerate(folds):
        test = np.where(np.isin(clip, fold))[0]
        train = np.where(~np.isin(clip, fold))[0]
        started = time.time()
        print("fold", n, [c[4:19] for c in fold], len(train), len(test), flush=True)
        net = fit(train, epochs)
        baseline = np.median(blade[train[state[train] < 2]], axis=0)
        for i in test:
            position, confidence, water = predict(net, i)
            results.append(
                {
                    "i": int(i),
                    "clip": str(clip[i]),
                    "state": int(state[i]),
                    "truth": blade[i].tolist(),
                    "pred": list(position),
                    "conf": confidence,
                    "water": water,
                    "base": baseline.tolist(),
                }
            )
        print(" took", round(time.time() - started), flush=True)
    (PRIVATE / "cv.json").write_text(json.dumps(results))


if __name__ == "__main__":
    epochs = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    if len(sys.argv) > 2 and sys.argv[2] != "cv":
        held = sys.argv[3].split(",") if len(sys.argv) > 3 else []
        train_and_export(sys.argv[2], held, epochs)
    else:
        cross_validate(epochs)
