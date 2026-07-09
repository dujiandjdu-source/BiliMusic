const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");
const path = require("path");
let mainWindow;

const BILIBILI_HOST_RE = /(^|\.)bilibili\.com$|(^|\.)biliapi\.net$|(^|\.)bilivideo\.com$/i;

function shouldRelaxEmbeddingHeaders(url) {
  try {
    const { hostname } = new URL(url);
    return BILIBILI_HOST_RE.test(hostname);
  } catch {
    return false;
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "bili-audio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: "netease-audio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "BiliMusic",
    backgroundColor: "#000000",
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // 窗口控制 IPC
  ipcMain.handle("win:minimize", () => mainWindow.minimize());
  ipcMain.handle("win:maximize", () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle("win:close", () => mainWindow.close());
  ipcMain.handle("win:isMaximized", () => mainWindow.isMaximized());

  // 监听最大化变化
  mainWindow.on("maximize", () =>
    mainWindow.webContents.send("win:maximizeChange", true)
  );
  mainWindow.on("unmaximize", () =>
    mainWindow.webContents.send("win:maximizeChange", false)
  );

  app.isPackaged
    ? mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"))
    : mainWindow.loadURL("http://localhost:3000");
}

app.whenReady().then(() => {
  const ses = session.defaultSession;

  // Allow the embedded Bilibili webview without weakening unrelated sites.
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldRelaxEmbeddingHeaders(details.url)) {
      callback({});
      return;
    }

    const headers = { ...details.responseHeaders };
    delete headers["x-frame-options"];
    delete headers["X-Frame-Options"];
    delete headers["content-security-policy"];
    delete headers["Content-Security-Policy"];
    callback({ responseHeaders: headers });
  });

  require("./ipc/system.cjs")(ipcMain);
  require("./ipc/bilibili.js")(ipcMain, ses);
  require("./ipc/netease.js")(ipcMain, ses);

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
