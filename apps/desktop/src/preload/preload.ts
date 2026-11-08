import { contextBridge, ipcRenderer, webUtils } from "electron";
import { CHANNELS, type AddRequest, type Bridge, type Colours } from "../shared/bridge";

// A fixed list of calls. The page never gets ipcRenderer itself.
const bridge: Bridge = {
  listClips: () => ipcRenderer.invoke(CHANNELS.listClips),
  getClip: (id: string) => ipcRenderer.invoke(CHANNELS.getClip, id),
  getColours: () => ipcRenderer.invoke(CHANNELS.getColours),
  setColours: (colours: Colours) => ipcRenderer.invoke(CHANNELS.setColours, colours),
  getSetup: () => ipcRenderer.invoke(CHANNELS.getSetup),
  addClip: (request: AddRequest) => ipcRenderer.invoke(CHANNELS.addClip, request),
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
};

contextBridge.exposeInMainWorld("rowvision", bridge);
