// Keep update state in the main process, independent of settings panel lifetime.
module.exports = function setupUpdater({ app, updater, ipcMain, getWindow, shell, portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE), schedule = true }) {
  const releaseUrl = 'https://github.com/dujiandjdu-source/BiliMusic/releases/latest';
  let state = { status: 'idle', currentVersion: app.getVersion(), portable, releaseUrl, progress: 0 };
  let operation = null;
  let downloadedPath = null;
  const publish = (patch) => {
    state = { ...state, ...patch };
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('updater:state', { ...state });
    return { ...state };
  };
  const fail = () => publish({ status: 'error', error: '更新失败，请检查网络后重试；也可前往 GitHub 下载。' });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  // Portable packages have no app-update.yml. Both editions use the same NSIS feed.
  updater.setFeedURL({ provider: 'github', owner: 'dujiandjdu-source', repo: 'BiliMusic' });
  updater.on('checking-for-update', () => publish({ status: 'checking', error: undefined, progress: 0 }));
  updater.on('update-available', (info) => publish({ status: 'available', version: info.version, error: undefined }));
  updater.on('update-not-available', () => publish({ status: 'up-to-date', version: undefined, error: undefined }));
  updater.on('download-progress', (info) => publish({ status: 'downloading', progress: Math.min(100, Math.max(0, Number(info.percent) || 0)) }));
  updater.on('update-downloaded', (info) => {
    downloadedPath = info.downloadedFile || updater.installerPath;
    publish({ status: 'downloaded', version: info.version, progress: 100, error: undefined });
  });
  updater.on('error', fail);

  const run = (action) => {
    if (operation) return operation;
    operation = Promise.resolve().then(action).catch(fail).finally(() => { operation = null; });
    return operation;
  };
  const check = () => {
    if (!app.isPackaged) return Promise.resolve(publish({ status: 'error', error: '开发模式不检查更新，请使用打包后的版本。' }));
    if (['downloaded', 'installing'].includes(state.status)) return Promise.resolve({ ...state });
    return run(async () => { await updater.checkForUpdates(); return { ...state }; });
  };
  const download = () => {
    if (operation) return operation;
    if (!state.version || !['available', 'error'].includes(state.status)) return Promise.resolve({ ...state });
    return run(async () => {
      publish({ status: 'downloading', progress: 0, error: undefined });
      const paths = await updater.downloadUpdate();
      downloadedPath = downloadedPath || paths?.[0] || updater.installerPath;
      return { ...state };
    });
  };
  const install = async () => {
    if (state.status !== 'downloaded') return { ...state };
    publish({ status: 'installing', error: undefined });
    try {
      if (portable) {
        if (!downloadedPath) throw new Error('Missing downloaded installer');
        const error = await shell.openPath(downloadedPath);
        if (error) throw new Error(error);
        app.quit();
      } else {
        updater.quitAndInstall(false, true);
      }
    } catch { fail(); }
    return { ...state };
  };
  // Only the trusted main renderer can request an installer or external page.
  const register = (channel, action) => ipcMain.handle(channel, (event) => {
    if (event.sender !== getWindow()?.webContents) throw new Error('Unauthorized update request');
    return action();
  });
  register('updater:get-state', () => ({ ...state }));
  register('updater:check', check);
  register('updater:download', download);
  register('updater:install', install);
  register('updater:open-release', () => shell.openExternal(releaseUrl));
  const timers = [];
  if (schedule && app.isPackaged) {
    timers.push(setTimeout(check, 5000), setInterval(() => {
      if (!operation && !['available', 'downloaded', 'installing'].includes(state.status)) void check();
    }, 6 * 60 * 60 * 1000));
    timers.forEach(timer => timer.unref?.());
  }
  app.once('before-quit', () => timers.forEach(timer => clearTimeout(timer)));
  return { check, download, install, getState: () => ({ ...state }) };
};
