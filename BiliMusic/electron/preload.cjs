const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
  storeGet: (k) => ipcRenderer.invoke("store-get", k),
  storeSet: (k, v) => ipcRenderer.invoke("store-set", k, v),
  // 窗口控制
  win: {
    minimize: () => ipcRenderer.invoke("win:minimize"),
    maximize: () => ipcRenderer.invoke("win:maximize"),
    close: () => ipcRenderer.invoke("win:close"),
    isMaximized: () => ipcRenderer.invoke("win:isMaximized"),
    onMaximizeChange: (cb) => {
      const fn = (_, v) => cb(v);
      ipcRenderer.on("win:maximizeChange", fn);
      return () => ipcRenderer.removeListener("win:maximizeChange", fn);
    },
  },
  download: {
    audio: (url, title) => ipcRenderer.invoke("download:audio", url, title),
    onProgress: (cb) => { const fn = (_, d) => cb(d); ipcRenderer.on("dl:progress", fn); return () => ipcRenderer.removeListener("dl:progress", fn); },
    onDone: (cb) => { const fn = (_, d) => cb(d); ipcRenderer.on("dl:done", fn); return () => ipcRenderer.removeListener("dl:done", fn); },
  },
  bili: {
    getLoginStatus: () => ipcRenderer.invoke("bili:login-status"),
    getQRCode: () => ipcRenderer.invoke("bili:qrcode"),
    checkQRLogin: (key) => ipcRenderer.invoke("bili:qrcode-poll", key),
    logout: () => ipcRenderer.invoke("bili:logout"),
    getFollowedUpList: (page, pageSize) =>
      ipcRenderer.invoke("bili:followings", page, pageSize),
    searchUp: (keyword) => ipcRenderer.invoke("bili:search-up", keyword),
    searchVideos: (keyword, page, pageSize) =>
      ipcRenderer.invoke("bili:search-videos", keyword, page, pageSize),
    getUpVideos: (mid, page, pageSize) =>
      ipcRenderer.invoke("bili:up-videos", mid, page, pageSize),
    getVideoInfo: (bvid) => ipcRenderer.invoke("bili:video-info", bvid),
    getVideoAudioUrl: (bvid, cid, quality) =>
      ipcRenderer.invoke("bili:audio-url", bvid, cid, quality),
  },
  netease: {
    getAudioUrl: (songId, quality) =>
      ipcRenderer.invoke("netease:audio-url", songId, quality),
  },
  setMode: (mode) => ipcRenderer.invoke("app:set-mode", mode),
});
