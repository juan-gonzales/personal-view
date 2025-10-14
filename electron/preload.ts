import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, ListRequest } from '../src/renderer/types';

const CHANNELS = {
  LIST: 'r2:list',
  SIGN: 'r2:sign',
  THUMB_GET: 'thumb:get',
  THUMB_SAVE: 'thumb:save',
  THUMB_CLEAR: 'thumb:clear',
  UPLOAD: 'r2:upload',
  UPLOAD_PROGRESS: 'r2:upload:progress',
  CREATE_FOLDER: 'r2:create-folder',
  DELETE_OBJECT: 'r2:delete-object',
  OPEN_EXTERNAL: 'system:open-external',
  DIAG: 'r2:diagnostics',
  PUBLIC_BASE: 'r2:public-base'
} as const;

const api: ElectronAPI = {
  listObjects(request: ListRequest) {
    return ipcRenderer.invoke(CHANNELS.LIST, request);
  },
  getSignedUrl(key: string) {
    return ipcRenderer.invoke(CHANNELS.SIGN, key);
  },
  getThumbnail(bucket, key, eTag) {
    return ipcRenderer.invoke(CHANNELS.THUMB_GET, { bucket, key, eTag });
  },
  saveThumbnail(bucket, key, eTag, dataUrl) {
    return ipcRenderer.invoke(CHANNELS.THUMB_SAVE, { bucket, key, eTag, dataUrl });
  },
  clearThumbnail(bucket, key, eTag) {
    return ipcRenderer.invoke(CHANNELS.THUMB_CLEAR, { bucket, key, eTag });
  },
  onUploadProgress(callback) {
    const handler = (_: unknown, payload: unknown) => {
      const event = payload as Parameters<typeof callback>[0];
      callback(event);
    };
    ipcRenderer.on(CHANNELS.UPLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(CHANNELS.UPLOAD_PROGRESS, handler);
  },
  uploadObject(prefix, filePath, fileName, id) {
    const uploadId = id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return ipcRenderer
      .invoke(CHANNELS.UPLOAD, { prefix, filePath, fileName, id: uploadId, channel: CHANNELS.UPLOAD_PROGRESS })
      .then((result) => ({ ...(result as object), id: uploadId })) as Promise<{ key: string; id: string }>;
  },
  createFolder(prefix, folderName) {
    return ipcRenderer.invoke(CHANNELS.CREATE_FOLDER, { prefix, folderName });
  },
  deleteObject(key) {
    return ipcRenderer.invoke(CHANNELS.DELETE_OBJECT, key);
  },
  openExternal(url) {
    return ipcRenderer.invoke(CHANNELS.OPEN_EXTERNAL, url);
  },
  diagnostics() {
    return ipcRenderer.invoke(CHANNELS.DIAG);
  },
  readPublicBase() {
    return ipcRenderer.invoke(CHANNELS.PUBLIC_BASE);
  }
};

contextBridge.exposeInMainWorld('electronAPI', api);
