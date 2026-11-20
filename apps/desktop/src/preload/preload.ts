import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { TargetChoices } from "../../../web/lib/targets";
import { CHANNELS, type AddRequest, type Analysis, type Bridge, type Colours, type ModelsState } from "../shared/bridge";

// A fixed list of calls. The page never gets ipcRenderer itself.
const bridge: Bridge = {
  listClips: () => ipcRenderer.invoke(CHANNELS.listClips),
  getClip: (id: string) => ipcRenderer.invoke(CHANNELS.getClip, id),
  getColours: () => ipcRenderer.invoke(CHANNELS.getColours),
  setColours: (colours: Colours) => ipcRenderer.invoke(CHANNELS.setColours, colours),
  getSetup: () => ipcRenderer.invoke(CHANNELS.getSetup),
  getTargets: () => ipcRenderer.invoke(CHANNELS.getTargets),
  setTargets: (targets: TargetChoices) => ipcRenderer.invoke(CHANNELS.setTargets, targets),
  addClip: (request: AddRequest) => ipcRenderer.invoke(CHANNELS.addClip, request),
  getAnalysis: () => ipcRenderer.invoke(CHANNELS.getAnalysis),
  onAnalysis: (listener: (analysis: Analysis) => void) => {
    // The page gets the news, never the event or the channel.
    const pass = (_event: unknown, analysis: Analysis) => listener(analysis);
    ipcRenderer.on(CHANNELS.analysisChanged, pass);
    return () => void ipcRenderer.removeListener(CHANNELS.analysisChanged, pass);
  },
  stopClip: (id: string) => ipcRenderer.invoke(CHANNELS.stopClip, id),
  startClip: (id: string) => ipcRenderer.invoke(CHANNELS.startClip, id),
  measureCrew: (id: string) => ipcRenderer.invoke(CHANNELS.measureCrew, id),
  exportPdf: (html: string, name: string) => ipcRenderer.invoke(CHANNELS.exportPdf, html, name),
  showReport: () => ipcRenderer.invoke(CHANNELS.showReport),
  getEffort: () => ipcRenderer.invoke(CHANNELS.getEffort),
  setEffort: (effort: string) => ipcRenderer.invoke(CHANNELS.setEffort, effort),
  tapAgain: (id: string, tap: { t: number; x: number; y: number }) => ipcRenderer.invoke(CHANNELS.tapAgain, id, tap),
  getSpace: () => ipcRenderer.invoke(CHANNELS.getSpace),
  deleteClip: (id: string) => ipcRenderer.invoke(CHANNELS.deleteClip, id),
  removeVideo: (id: string) => ipcRenderer.invoke(CHANNELS.removeVideo, id),
  canSend: () => ipcRenderer.invoke(CHANNELS.canSend),
  sendClip: (id: string, consent: { note: string; adult: boolean; allowed: boolean }) => ipcRenderer.invoke(CHANNELS.sendClip, id, consent),
  engineVersion: () => ipcRenderer.invoke(CHANNELS.engineVersion),
  measureAgain: (id: string) => ipcRenderer.invoke(CHANNELS.measureAgain, id),
  getModels: () => ipcRenderer.invoke(CHANNELS.getModels),
  downloadModels: () => ipcRenderer.invoke(CHANNELS.downloadModels),
  cancelModels: () => ipcRenderer.invoke(CHANNELS.cancelModels),
  onModels: (listener: (state: ModelsState) => void) => {
    const pass = (_event: unknown, state: ModelsState) => listener(state);
    ipcRenderer.on(CHANNELS.modelsChanged, pass);
    return () => void ipcRenderer.removeListener(CHANNELS.modelsChanged, pass);
  },
  getWelcome: () => ipcRenderer.invoke(CHANNELS.getWelcome),
  changeClipsFolder: () => ipcRenderer.invoke(CHANNELS.changeClipsFolder),
  finishWelcome: () => ipcRenderer.invoke(CHANNELS.finishWelcome),
  onSendProgress: (listener: (progress: { id: string; sent: number; total: number }) => void) => {
    const pass = (_event: unknown, progress: { id: string; sent: number; total: number }) => listener(progress);
    ipcRenderer.on(CHANNELS.sendProgress, pass);
    return () => void ipcRenderer.removeListener(CHANNELS.sendProgress, pass);
  },
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
};

contextBridge.exposeInMainWorld("rowvision", bridge);
