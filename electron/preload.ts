import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "../electron-env";

type UploadProgressListener = (progress: number) => void;

const api: ElectronAPI = {
  onUploadProgress: (cb: UploadProgressListener) => {
    ipcRenderer.on("upload-progress", (_event, value: number) => cb(value));
    ipcRenderer.send("upload-progress");
  },
  listFiles: () => ipcRenderer.invoke("list-files"),
  openFile: (key) => ipcRenderer.invoke("open-file", key)
};

contextBridge.exposeInMainWorld("electronAPI", api);
