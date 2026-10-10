const { app, BrowserWindow, BrowserView, ipcMain, protocol, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
let mainWindow;
let browserView = null;
let desktop;
let browserChromeVisible = true;

const BILIBILI_HOST_RE = /(^|\.)(bilibili|b23|hdslb)\.(com|tv)$|(^|\.)biliapi\.net$|(^|\.)bilivideo\.com$/i;
const BILIBILI_URL = "https://www.bilibili.com/";
const TOOLBAR_H = 36;
const SIDEBAR_W = 48;

function isHttp(url) {
  try { const p = new URL(url); return p.protocol === "https:" || p.protocol === "http:"; } catch { return false; }
}
function shouldRelaxEmbeddingHeaders(url) {
  try { return BILIBILI_HOST_RE.test(new URL(url).hostname); } catch { return false; }
}

protocol.registerSchemesAsPrivileged([
  { scheme: "bili-audio", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "netease-audio", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function getBounds() {
  if (!mainWindow) return { x: SIDEBAR_W, y: TOOLBAR_H, width: 1280 - SIDEBAR_W, height: 800 - TOOLBAR_H };
  const [w, h] = mainWindow.getSize();
  const left = browserChromeVisible ? SIDEBAR_W : 4;
  const top = browserChromeVisible ? TOOLBAR_H : 4;
  return { x: left, y: top, width: w - left, height: h - top };
}

function createBrowserView() {
  if (browserView) return;
  browserView = new BrowserView({ webPreferences: { nodeIntegration: false, contextIsolation: true, javascript: true, webSecurity: true, allowRunningInsecureContent: false, partition: "persist:bilibili" } });
  browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  mainWindow.addBrowserView(browserView);

  const wc = browserView.webContents;
  wc.setWindowOpenHandler(({ url }) => { if (isHttp(url)) wc.loadURL(url); return { action: "deny" }; });
  wc.loadURL(BILIBILI_URL);

  const sendState = () => {
    if (!mainWindow || !browserView) return;
    try {
      mainWindow.webContents.send("browser:urlChanged", wc.getURL() || BILIBILI_URL);
      mainWindow.webContents.send("browser:navState", { canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward(), isLoading: wc.isLoading() });
    } catch { /* noop */ }
  };
  wc.on("did-navigate", sendState);
  wc.on("did-navigate-in-page", sendState);
  wc.on("did-start-loading", sendState);
  wc.on("did-stop-loading", sendState);
}

function showBrowserView() {
  if (!browserView) createBrowserView();
  browserView.setBounds(getBounds());
  if (mainWindow) {
    const wc = browserView.webContents;
    mainWindow.webContents.send("browser:urlChanged", wc.getURL() || BILIBILI_URL);
    mainWindow.webContents.send("browser:navState", { canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward(), isLoading: wc.isLoading() });
  }
}

function hideBrowserView() {
  if (!browserView) return;
  try { browserView.webContents.executeJavaScript('document.querySelector("video")?.pause()'); } catch {}
  browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: "BiliMusic", backgroundColor: "#0b0c10",
    frame: false, thickFrame: false, titleBarStyle: "hidden",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, webviewTag: false, backgroundThrottling: false },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (isHttp(url)) shell.openExternal(url); return { action: "deny" }; });

  mainWindow.on("resize", () => { if (browserView && browserView.getBounds().width > 0) browserView.setBounds(getBounds()); });
  mainWindow.on("close", (event) => {
    if (desktop?.shouldHideOnClose()) { event.preventDefault(); mainWindow.hide(); }
  });

  // Native clipping also rounds BrowserView and portaled dialogs on Windows 10.
  const updateWindowShape = () => {
    if (process.platform !== 'win32' || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized() || mainWindow.isFullScreen()) { mainWindow.setShape([]); return; }
    const [width, height] = mainWindow.getSize();
    const radius = 10;
    const rects = [{ x: 0, y: radius, width, height: height - radius * 2 }];
    for (let y = 0; y < radius; y++) {
      const inset = Math.ceil(radius - Math.sqrt(radius * radius - (radius - y - 0.5) ** 2));
      rects.push({ x: inset, y, width: width - inset * 2, height: 1 },
        { x: inset, y: height - y - 1, width: width - inset * 2, height: 1 });
    }
    mainWindow.setShape(rects);
  };
  updateWindowShape();
  for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(event, updateWindowShape);
  }

  ipcMain.handle("win:minimize", () => mainWindow.minimize());
  ipcMain.handle("win:maximize", () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
  ipcMain.handle("win:close", () => mainWindow.close());
  ipcMain.handle("win:isMaximized", () => mainWindow.isMaximized());
  ipcMain.handle("win:get-position", (event) => BrowserWindow.fromWebContents(event.sender)?.getPosition() || [0, 0]);
  ipcMain.handle("win:move-to", (event, x, y) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && Number.isFinite(x) && Number.isFinite(y) && !window.isMaximized()) window.setPosition(Math.round(x), Math.round(y));
  });
  mainWindow.on("maximize", () => mainWindow.webContents.send("win:maximizeChange", true));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("win:maximizeChange", false));

  ipcMain.handle("browser:show", () => { showBrowserView(); });
  ipcMain.handle("browser:chrome", (_event, visible) => {
    browserChromeVisible = visible !== false;
    if (browserView && browserView.getBounds().width > 0) browserView.setBounds(getBounds());
  });
  ipcMain.handle("browser:hide", () => { hideBrowserView(); });
  ipcMain.handle("browser:navigate", (_e, url) => { if (browserView && isHttp(url)) browserView.webContents.loadURL(url); });
  ipcMain.handle("browser:goBack", () => { if (browserView) browserView.webContents.goBack(); });
  ipcMain.handle("browser:goForward", () => { if (browserView) browserView.webContents.goForward(); });
  ipcMain.handle("browser:reload", () => { if (browserView) browserView.webContents.reload(); });
  ipcMain.handle("browser:goHome", () => { if (browserView) browserView.webContents.loadURL(BILIBILI_URL); });
  ipcMain.handle("browser:getUrl", () => { if (!browserView) return BILIBILI_URL; try { return browserView.webContents.getURL() || BILIBILI_URL; } catch { return BILIBILI_URL; } });

  
  require('./updater.cjs')({ app, updater: autoUpdater, ipcMain, getWindow: () => mainWindow, shell });

  app.isPackaged ? mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html")) : mainWindow.loadURL("http://localhost:3000");
}

const setupSession = (ses) => {
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldRelaxEmbeddingHeaders(details.url)) { callback({}); return; }
    const h = { ...details.responseHeaders };
    delete h["x-frame-options"]; delete h["X-Frame-Options"];
    delete h["content-security-policy"]; delete h["Content-Security-Policy"];
    callback({ responseHeaders: h });
  });
};

app.whenReady().then(() => {
  const ses = session.defaultSession;
  setupSession(ses);
  setupSession(session.fromPartition("persist:bilibili"));
  require("./ipc/system.cjs")(ipcMain);
  require("./ipc/bilibili.js")(ipcMain, ses);
  require("./ipc/netease.js")(ipcMain, ses);
  require('./netease-metadata.cjs')(ipcMain, ses);
  createWindow();
  desktop = require('./desktop.cjs')(() => mainWindow);
  createBrowserView();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
