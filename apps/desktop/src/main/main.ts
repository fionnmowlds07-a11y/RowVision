import path from "node:path";
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from "electron";
import { APP_ORIGIN, CHANNELS, CLIP_ID } from "../shared/bridge";
import { listClips, readClip } from "./library";
import { registerSchemes, serve } from "./protocol";
import { cleanColours, readColours, writeColours } from "./settings";

// Tests point the app at a throwaway folder. Everyone else uses the system's app data folder.
if (process.env.ROWVISION_DATA_DIR) app.setPath("userData", path.resolve(process.env.ROWVISION_DATA_DIR));

const pageRoot = path.join(__dirname, "..", "renderer");
const library = () => path.join(app.getPath("userData"), "clips");
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const START = `${APP_ORIGIN}/index.html`;

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
    const allowed = details.url.startsWith(`${APP_ORIGIN}/`) || details.url.startsWith("rowvision:") || details.url.startsWith("devtools:");
    reply({ cancel: !allowed });
  });
  ours.setPermissionRequestHandler((_, __, reply) => reply(false));
  ours.setPermissionCheckHandler(() => false);

  serve(pageRoot, library());

  handle(CHANNELS.listClips, () => listClips(library()));
  handle(CHANNELS.getClip, async (id) => (typeof id === "string" && CLIP_ID.test(id) ? readClip(library(), id) : null));
  handle(CHANNELS.getColours, () => readColours(settingsFile()));
  handle(CHANNELS.setColours, async (value) => {
    const colours = cleanColours(value);
    if (!colours) throw new Error("Not a colour");
    await writeColours(settingsFile(), colours);
    return colours;
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
