const { BrowserWindow, ipcMain, app, screen } = require('electron');
const path = require('path');

module.exports = function createDesktopLyrics(getState, onPreferences) {
  let window = null;
  let preferences = { topmost: true, locked: false, clickThrough: false, fontSize: 30,
    fontFamily: 'Microsoft YaHei', color: '#ffffff', translationColor: '#f9a8d4' };
  const apply = () => {
    if (!window || window.isDestroyed()) return;
    window.setAlwaysOnTop(preferences.topmost, 'floating');
    window.setMovable(!preferences.locked);
    window.setResizable(!preferences.locked);
    window.setIgnoreMouseEvents(preferences.clickThrough, { forward: true });
    window.webContents.send('desktop:lyrics-preferences', preferences);
  };
  const update = (incoming) => {
    if (!incoming || typeof incoming !== 'object') return preferences;
    for (const key of ['topmost','locked','clickThrough']) if (typeof incoming[key] === 'boolean') preferences[key] = incoming[key];
    if (Number.isFinite(incoming.fontSize)) preferences.fontSize = Math.max(16,Math.min(72,incoming.fontSize));
    if (typeof incoming.fontFamily === 'string' && incoming.fontFamily.trim()) preferences.fontFamily = incoming.fontFamily.slice(0,80);
    for (const key of ['color','translationColor']) if (typeof incoming[key] === 'string' && /^#[0-9a-f]{6}$/i.test(incoming[key])) preferences[key] = incoming[key];
    apply(); return { ...preferences };
  };
  const open = () => {
    if (!window || window.isDestroyed()) {
      const area = screen.getPrimaryDisplay().workArea;
      const width = Math.min(900, area.width), height = 180;
      window = new BrowserWindow({ width, height, minWidth: Math.min(360,area.width), minHeight: 120,
        x: area.x+Math.round((area.width-width)/2), y: area.y+area.height-height-24,
        title: 'BiliMusic 桌面歌词', transparent: true, backgroundColor: '#00000000',
        frame: false, hasShadow: false, skipTaskbar: true, maximizable: false,
        webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation: true, nodeIntegration: false },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('did-finish-load', apply);
      window.on('closed',()=>{window=null;});
      if (app.isPackaged) window.loadFile(path.join(__dirname,'..','dist','index.html'),{query:{panel:'lyrics'}});
      else window.loadURL('http://localhost:3000/?panel=lyrics');
    }
    apply(); window.showInactive(); return true;
  };
  const unlock = () => { update({locked:false,clickThrough:false}); onPreferences({...preferences}); };
  ipcMain.handle('desktop:lyrics', open);
  ipcMain.handle('desktop:get-lyrics-preferences',()=>({...preferences}));
  ipcMain.handle('desktop:set-lyrics-preferences',(_event,prefs)=>update(prefs));
  ipcMain.handle('desktop:unlock-lyrics',unlock);
  ipcMain.handle('desktop:close-lyrics',(event)=>{if(window && event.sender===window.webContents) window.close();});
  return { open, unlock, updateState:()=>{if(window && !window.isDestroyed()) window.webContents.send('desktop:state',getState());} };
};
