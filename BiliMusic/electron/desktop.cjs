const { BrowserWindow, Tray, Menu, nativeImage, app, ipcMain, globalShortcut } = require('electron');
const path = require('path');

// The main renderer owns the only audio element. Auxiliary windows send
// commands and display snapshots, so opening them never starts a second player.
module.exports = function setupDesktop(getMainWindow) {
  let mini = null, tray = null, quitting = false;
  let state = { title: 'BiliMusic', artist: '选择一首歌曲', isPlaying: false, liked: false };
  let menuKey = '';
  const main = () => { const win = getMainWindow(); return win && !win.isDestroyed() ? win : null; };
  const sendCommand = (command) => main()?.webContents.send('desktop:command', command);
  const shortcuts = require('./global-shortcuts.cjs')(globalShortcut, sendCommand);
  const lyrics = require('./desktop-lyrics.cjs')(() => state,
    (preferences) => main()?.webContents.send('desktop:lyrics-preferences', preferences));
  ipcMain.handle('desktop:shortcuts', (_event, bindings) => shortcuts.configure(bindings));
  const restore = () => { const win = main(); if (!win) return; win.restore(); win.show(); win.focus(); };
  const updateMenu = () => {
    if (!tray) return;
    const key = JSON.stringify([state.title, state.isPlaying]);
    if (menuKey === key) return;
    menuKey = key;
    tray.setToolTip(('BiliMusic · '+state.title).slice(0, 120));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 BiliMusic', click: restore },
      { label: '迷你播放器', click: openMini },
      { label: '桌面歌词', click: lyrics.open },
      { label: '解锁桌面歌词（关闭穿透）', click: lyrics.unlock },
      { type: 'separator' },
      { label: state.isPlaying ? '暂停' : '播放', click: () => sendCommand('toggle') },
      { label: '上一首', click: () => sendCommand('previous') },
      { label: '下一首', click: () => sendCommand('next') },
      { type: 'separator' },
      { label: '退出 BiliMusic', click: () => app.quit() },
    ]));
  };
  function openMini() {
    if (!mini || mini.isDestroyed()) {
      mini = new BrowserWindow({ width: 360, height: 310, minWidth: 340, minHeight: 108,
        resizable: false, frame: false, transparent: true, alwaysOnTop: true, title: 'BiliMusic 迷你播放器', backgroundColor: '#00000000',
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
      });
      mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      mini.on('closed', () => { mini = null; });
      if (app.isPackaged) mini.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { panel: 'mini' } });
      else mini.loadURL('http://localhost:3000/?panel=mini');
    }
    mini.show();
    main()?.hide();
    return true;
  }
  ipcMain.handle('desktop:mini', openMini);
  ipcMain.handle('desktop:state', () => state);
  ipcMain.handle('desktop:update', (event, incoming) => {
    if (event.sender !== main()?.webContents || !incoming || typeof incoming !== 'object') return;
    state = {
      songId: typeof incoming.songId === 'string' ? incoming.songId : '',
      queue: Array.isArray(incoming.queue) ? incoming.queue.filter(song => song && typeof song.id === 'string' && typeof song.title === 'string').map(song => ({
        id: song.id, title: song.title.slice(0, 500), artist: typeof song.artist === 'string' ? song.artist.slice(0, 500) : '', liked: song.liked === true,
      })) : [],
      title: typeof incoming.title === 'string' ? incoming.title.slice(0, 500) : 'BiliMusic',
      artist: typeof incoming.artist === 'string' ? incoming.artist.slice(0, 500) : '',
      coverUrl: typeof incoming.coverUrl === 'string' ? incoming.coverUrl : '',
      isPlaying: incoming.isPlaying === true, liked: incoming.liked === true,
      currentTime: Number.isFinite(incoming.currentTime) ? incoming.currentTime : 0,
      duration: Number.isFinite(incoming.duration) ? incoming.duration : 0,
      lyric: typeof incoming.lyric === 'string' ? incoming.lyric.slice(0, 4000) : '',
      translation: typeof incoming.translation === 'string' ? incoming.translation.slice(0, 4000) : '',
    };
    if (mini && !mini.isDestroyed()) mini.webContents.send('desktop:state', state);
    lyrics.updateState();
    updateMenu();
  });
  ipcMain.handle('desktop:command', (_event, command) => {
    if (command && typeof command === 'object' && ['play-song', 'like-song'].includes(command.action) &&
        typeof command.songId === 'string' && state.queue?.some(song => song.id === command.songId)) {
      sendCommand({ action: command.action, songId: command.songId });
      return;
    }
    if (['toggle', 'previous', 'next', 'like', 'favorite'].includes(command)) sendCommand(command);
    if (command === 'restore') restore();
  });
  ipcMain.handle('desktop:mini-expanded', (event, expanded) => {
    if (!mini || event.sender !== mini.webContents) return;
    // Windows can retain the last fixed-size constraints after an expansion.
    // Lift them while applying the next size, then restore the fixed window.
    mini.setResizable(true);
    try {
      mini.setSize(360, expanded === true ? 310 : 108);
    } finally {
      mini.setResizable(false);
    }
  });
  ipcMain.handle('desktop:topmost', (event, value) => {
    if (mini && event.sender === mini.webContents) mini.setAlwaysOnTop(value === true);
    return mini?.isAlwaysOnTop() ?? false;
  });
  ipcMain.handle('desktop:close', (event) => {
    if (mini && event.sender === mini.webContents) mini.close();
  });
  ipcMain.handle('desktop:quit', () => app.quit());
  app.on('before-quit', () => { quitting = true; shortcuts.dispose(); tray?.destroy(); tray = null; });
  // Generate the app tray glyph in memory; no user artwork is embedded.
  try {
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const note = ((x >= 17 && x <= 20 && y >= 6 && y <= 23) || (y >= 6 && y <= 9 && x >= 17 && x <= 26) ||
        ((x - 14) ** 2 / 25 + (y - 24) ** 2 / 16 < 1));
      const inside = (x - 16) ** 2 + (y - 16) ** 2 < 240;
      pixels[i] = note ? 255 : 160; pixels[i+1] = note ? 255 : 72; pixels[i+2] = note ? 255 : 220;
      pixels[i+3] = inside ? 255 : 0;
    }
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }));
    tray.on('click', restore); updateMenu();
  } catch (error) { console.warn('System tray unavailable', error.message); }
  return {
    shouldHideOnClose: () => !quitting && Boolean(tray),
  };
};
