"""The pose models can be held to a number of processor cores, so analysis can leave room for other work."""

import sys
import types
from typing import Any

import pytest

from rowvision.pose import RtmBackend


class FakeOptions:
    intra_op_num_threads = 0
    inter_op_num_threads = 0


@pytest.fixture
def made(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Stand in for rtmlib and ONNX Runtime, recording how each model session is made."""
    sessions: list[dict[str, Any]] = []
    ort = types.ModuleType("onnxruntime")
    ort.SessionOptions = FakeOptions  # type: ignore[attr-defined]
    ort.InferenceSession = lambda *args, **kwargs: sessions.append(kwargs) or object()  # type: ignore[attr-defined]

    class Body:
        def __init__(self, **_: Any) -> None:
            # Like rtmlib, which looks the module up as it makes each model.
            import onnxruntime

            self.det_model = onnxruntime.InferenceSession(path_or_bytes="det.onnx", providers=["cpu"])
            self.pose_model = onnxruntime.InferenceSession(path_or_bytes="pose.onnx", providers=["cpu"])

    rtmlib = types.ModuleType("rtmlib")
    rtmlib.Body = Body  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "onnxruntime", ort)
    monkeypatch.setitem(sys.modules, "rtmlib", rtmlib)
    return sessions


def test_no_cap_leaves_the_models_as_rtmlib_makes_them(made: list[dict[str, Any]]) -> None:
    RtmBackend()
    assert [session.get("sess_options") for session in made] == [None, None]


def test_a_cap_reaches_both_models_and_is_undone_after(made: list[dict[str, Any]]) -> None:
    before = sys.modules["onnxruntime"].InferenceSession
    RtmBackend(threads=2)
    assert len(made) == 2
    assert all(session["sess_options"].intra_op_num_threads == 2 for session in made)
    assert all(session["sess_options"].inter_op_num_threads == 1 for session in made)
    assert sys.modules["onnxruntime"].InferenceSession is before
