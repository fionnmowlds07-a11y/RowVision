import { existsSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Notification, powerMonitor, session, shell, type IpcMainInvokeEvent } from "electron";
import { APP_ORIGIN, CHANNELS, CLIP_ID, type Analysis, type ClipItem } from "../shared/bridge";
import { addClip, cleanAdd } from "./add";
import { Analyser } from "./analysis";
import { deleteClip, librarySpace, listClips, readClip, removeVideo } from "./library";
import { registerSchemes, serve } from "./protocol";
import { cleanConsent, sendClip } from "./send";
import { cleanColours, readColours, readSetup, readSpeed, saveSettings, writeColours } from "./settings";

// Tests point the app at a throwaway folder. Everyone else uses the system's app data folder.
if (process.env.ROWVISION_DATA_DIR) app.setPath("userData", path.resolve(process.env.ROWVISION_DATA_DIR));

const pageRoot = path.join(__dirname, "..", "renderer");
const library = () => path.join(app.getPath("userData"), "clips");
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const START = `${APP_ORIGIN}/index.html`;

/** The measuring program, shipped beside the app. ROWVISION_ENGINE stands in for it in development and tests. */
function engineCommand(): string[] | null {
  if (process.env.ROWVISION_ENGINE) return JSON.parse(process.env.ROWVISION_ENGINE) as string[];
  const program = path.join(process.resourcesPath, "engine", process.platform === "win32" ? "rowvision-engine.exe" : "rowvision-engine");
  return existsSync(program) ? [program] : null;
}

// Tests read what would have popped up, rather than filling the desktop with notifications.
const testNotices: { title: string; body: string; id: string }[] = [];
(globalThis as { rowvisionNotices?: typeof testNotices }).rowvisionNotices = testNotices;

function notify(title: string, body: string, id: string) {
  if (process.env.ROWVISION_TEST_NOTICES) {
    testNotices.push({ title, body, id });
    return;
  }
  if (!Notification.isSupported()) return;
  const notice = new Notification({ title, body });
  notice.on("click", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
    window.webContents.send(CHANNELS.analysisChanged, analyser.snapshot());
  });
  notice.show();
}

const analyser = new Analyser({
  library,
  engine: engineCommand,
  kind: process.env.ROWVISION_ENGINE_KIND ?? "real",
  onChange: (analysis: Analysis) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.analysisChanged, analysis);
  },
  notify,
  onBattery: () => powerMonitor.isOnBatteryPower(),
  readSpeed: () => readSpeed(settingsFile()),
  saveSpeed: (speed) => saveSettings(settingsFile(), { speed }),
});

/** The library only knows a clip is waiting. The analyser knows which one is running. */
function withRunning<T extends ClipItem>(clip: T): T {
  return analyser.snapshot().running?.id === clip.id ? { ...clip, state: "running" } : clip;
}

function cleanTap(value: unknown): { t: number; x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const { t, x, y } = value as Record<string, unknown>;
  const ok = (n: unknown, top: number) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= top;
  return ok(t, 24 * 3600) && ok(x, 1) && ok(y, 1) ? { t: t as number, x: x as number, y: y as number } : null;
}

const clipId = (id: unknown): string => {
  if (typeof id !== "string" || !CLIP_ID.test(id)) throw new Error("Not a clip");
  return id;
};

registerSchemes();
app.enableSandbox();

if (!app.requestSingleInstanceLock()) app.quit();

app.on("second-instance", () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

// Every page, now or later, is held to the same rules.
app.on("web-contents-created", (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    // Research sources open in the user's own browser, never inside the app.
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  const stayHome = (event: Electron.Event, url: string) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  };
  contents.on("will-navigate", stayHome);
  contents.on("will-redirect", stayHome);
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

function fromOurPage(event: IpcMainInvokeEvent) {
  return event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true;
}

function handle(channel: string, run: (...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOurPage(event)) throw new Error("Not allowed");
    return run(...args);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#070b09",
    title: "RowVision",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  void window.loadURL(START);
}

void app.whenReady().then(() => {
  const ours = session.defaultSession;
  // Nothing remote is ever loaded, and the page never gets the camera, microphone or anything else.
  ours.webRequest.onBeforeRequest((details, reply) => {
    const allowed = details.url.startsWith(`${APP_ORIGIN}/`) || details.url.startsWith("rowvision:") || details.url.startsWith(`blob:${APP_ORIGIN}/`) || details.url.startsWith("devtools:");
    reply({ cancel: !allowed });
  });
  ours.setPermissionRequestHandler((_, __, reply) => reply(false));
  ours.setPermissionCheckHandler(() => false);

  serve(pageRoot, library());

  handle(CHANNELS.listClips, async () => (await listClips(library())).map(withRunning));
  handle(CHANNELS.getClip, async (id) => {
    const clip = typeof id === "string" && CLIP_ID.test(id) ? await readClip(library(), id) : null;
    return clip ? withRunning(clip) : null;
  });
  handle(CHANNELS.getAnalysis, async () => analyser.snapshot());
  handle(CHANNELS.getSpace, async () => librarySpace(library(), await listClips(library())));
  handle(CHANNELS.deleteClip, async (id) => {
    const clip = clipId(id);
    await analyser.forget(clip);
    await deleteClip(library(), clip);
    await analyser.next();
  });
  // Where sent clips go. Unset until the owner sets up the service, so nothing can be sent by accident.
  const sendBase = process.env.ROWVISION_SEND_URL ?? "";
  handle(CHANNELS.canSend, async () => sendBase !== "");
  handle(CHANNELS.sendClip, async (id, consent) => {
    const clip = clipId(id);
    const agreed = cleanConsent(consent);
    if (!agreed || !sendBase) throw new Error("Not allowed");
    await sendClip(library(), clip, agreed, sendBase, (sent, total) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.sendProgress, { id: clip, sent, total });
    });
  });
  handle(CHANNELS.removeVideo, (id) => removeVideo(library(), clipId(id)));
  handle(CHANNELS.stopClip, (id) => analyser.stop(clipId(id)));
  handle(CHANNELS.startClip, (id) => analyser.restart(clipId(id)));
  handle(CHANNELS.tapAgain, (id, tap) => {
    const point = cleanTap(tap);
    if (!point) throw new Error("Not a tap");
    return analyser.tap(clipId(id), point);
  });
  handle(CHANNELS.getColours, () => readColours(settingsFile()));
  handle(CHANNELS.setColours, async (value) => {
    const colours = cleanColours(value);
    if (!colours) throw new Error("Not a colour");
    await writeColours(settingsFile(), colours);
    return colours;
  });

  handle(CHANNELS.getSetup, () => readSetup(settingsFile()));
  handle(CHANNELS.addClip, async (value) => {
    const request = cleanAdd(value);
    if (!request) throw new Error("Not a clip");
    const id = await addClip(library(), request);
    await saveSettings(settingsFile(), { setup: request.setup });
    await analyser.next();
    return id;
  });

  powerMonitor.on("on-battery", () => analyser.changed());
  powerMonitor.on("on-ac", () => analyser.changed());
  // Anything left waiting, or cut off when the app last closed, starts again.
  void analyser.start();

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => analyser.shutdown());
app.on("window-all-closed", () => app.quit());
