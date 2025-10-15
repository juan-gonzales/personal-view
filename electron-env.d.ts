export interface ElectronAPI {
  onUploadProgress: (cb: (progress: number) => void) => void;
  listFiles: () => Promise<string[]>;
  openFile: (key: string) => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
