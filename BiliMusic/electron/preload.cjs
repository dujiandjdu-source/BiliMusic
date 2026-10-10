const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),
  storeGet: (k) => ipcRenderer.invoke("store-get", k),
  storeSet: (k, v) => ipcRenderer.invoke("store-set", k, v),
  desktop: {
    openMini: () => ipcRenderer.invoke('desktop:mini'),
    openLyrics: () => ipcRenderer.invoke('desktop:lyrics'),
    getLyricsPreferences: () => ipcRenderer.invoke('desktop:get-lyrics-preferences'),
    setLyricsPreferences: (preferences) => ipcRenderer.invoke('desktop:set-lyrics-preferences', preferences),
    unlockLyrics: () => ipcRenderer.invoke('desktop:unlock-lyrics'),
    closeLyrics: () => ipcRenderer.invoke('desktop:close-lyrics'),
    configureShortcuts: (bindings) => ipcRenderer.invoke('desktop:shortcuts', bindings),
    onLyricsPreferences: (cb) => { const fn = (_, preferences) => cb(preferences); ipcRenderer.on('desktop:lyrics-preferences',fn); return () => ipcRenderer.removeListener('desktop:lyrics-preferences',fn); },
    getState: () => ipcRenderer.invoke('desktop:state'),
    updateState: (state) => ipcRenderer.invoke('desktop:update', state),
    command: (command) => ipcRenderer.invoke('desktop:command', command),
    setTopmost: (value) => ipcRenderer.invoke('desktop:topmost', value),
    closePanel: () => ipcRenderer.invoke('desktop:close'),
    quit: () => ipcRenderer.invoke('desktop:quit'),
    onCommand: (cb) => { const fn = (_, command) => cb(command); ipcRenderer.on('desktop:command', fn); return () => ipcRenderer.removeListener('desktop:command', fn); },
    onState: (cb) => { const fn = (_, state) => cb(state); ipcRenderer.on('desktop:state', fn); return () => ipcRenderer.removeListener('desktop:state', fn); },
  },
  win: {
    minimize: () => ipcRenderer.invoke("win:minimize"),
    maximize: () => ipcRenderer.invoke("win:maximize"),
    close: () => ipcRenderer.invoke("win:close"),
    isMaximized: () => ipcRenderer.invoke("win:isMaximized"),
    getPosition: () => ipcRenderer.invoke("win:get-position"),
    moveTo: (x, y) => ipcRenderer.invoke("win:move-to", x, y),
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
    getFollowedUpList: (page, pageSize) => ipcRenderer.invoke("bili:followings", page, pageSize),
    searchUp: (keyword) => ipcRenderer.invoke("bili:search-up", keyword),
    searchVideos: (keyword, page, pageSize) => ipcRenderer.invoke("bili:search-videos", keyword, page, pageSize),
    getUpVideos: (mid, page, pageSize) => ipcRenderer.invoke("bili:up-videos", mid, page, pageSize),
    getVideoInfo: (bvid) => ipcRenderer.invoke("bili:video-info", bvid),
    getVideoAudioUrl: (bvid, cid, quality) => ipcRenderer.invoke("bili:audio-url", bvid, cid, quality),
  },
  netease: {
    searchSongs: (keyword, limit, offset) => ipcRenderer.invoke('netease:search-songs', keyword, limit, offset),
    getLyrics: (songId) => ipcRenderer.invoke('netease:lyrics', songId),
    getAudioUrl: (songId, quality) => ipcRenderer.invoke("netease:audio-url", songId, quality),
    setMeta: (songId, title, artist) => ipcRenderer.invoke("netease:set-meta", songId, title, artist),
  },
  cache: {
    clear: () => ipcRenderer.invoke("cache:clear"),
  },
  /* ---- BrowserView ---- */
  browser: {
    show: () => ipcRenderer.invoke("browser:show"),
    hide: () => ipcRenderer.invoke("browser:hide"),
    navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
    goBack: () => ipcRenderer.invoke("browser:goBack"),
    goForward: () => ipcRenderer.invoke("browser:goForward"),
    reload: () => ipcRenderer.invoke("browser:reload"),
    goHome: () => ipcRenderer.invoke("browser:goHome"),
    getUrl: () => ipcRenderer.invoke("browser:getUrl"),
    onUrlChanged: (cb) => { const fn = (_, url) => cb(url); ipcRenderer.on("browser:urlChanged", fn); return () => ipcRenderer.removeListener("browser:urlChanged", fn); },
    onNavState: (cb) => { const fn = (_, s) => cb(s); ipcRenderer.on("browser:navState", fn); return () => ipcRenderer.removeListener("browser:navState", fn); },
  },
  setMode: (mode) => ipcRenderer.invoke("app:set-mode", mode),

});
