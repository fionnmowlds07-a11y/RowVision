import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type Bridge, type Colours } from "../shared/bridge";

// A fixed list of calls. The page never gets ipcRenderer itself.
const bridge: Bridge = {
  listClips: () => ipcRenderer.invoke(CHANNELS.listClips),
  getClip: (id: string) => ipcRenderer.invoke(CHANNELS.getClip, id),
  getColours: () => ipcRenderer.invoke(CHANNELS.getColours),
  setColours: (colours: Colours) => ipcRenderer.invoke(CHANNELS.setColours, colours),
};

contextBridge.exposeInMainWorld("rowvision", bridge);
