import { ElectronAPI } from './src/renderer/types';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
