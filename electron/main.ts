import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

const progressIntervals = new Map<number, NodeJS.Timeout>();

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadURL(`file://${path.join(__dirname, "../dist/renderer/index.html")}`);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function clearProgressTimer(id: number) {
  const timer = progressIntervals.get(id);
  if (timer) {
    clearInterval(timer);
    progressIntervals.delete(id);
  }
}

ipcMain.on("upload-progress", (event) => {
  const senderId = event.sender.id;
  if (progressIntervals.has(senderId)) {
    return;
  }

  const sendProgress = () => {
    event.sender.send("upload-progress", Math.random());
  };

  sendProgress();
  const interval = setInterval(sendProgress, 1000);
  progressIntervals.set(senderId, interval);

  event.sender.once("destroyed", () => {
    clearProgressTimer(senderId);
  });
});

ipcMain.handle("list-files", async () => {
  return ["foto1.jpg", "video1.mov", "documento.pdf"];
});

ipcMain.handle("open-file", async (_event, key: string) => {
  return `signed-url-for-${key}`;
});
