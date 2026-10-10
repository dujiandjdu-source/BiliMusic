const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const setup = require('../../electron/updater.cjs');

function harness(portable = false) {
  const updater = new EventEmitter(), app = new EventEmitter(), handlers = new Map(), calls = [];
  Object.assign(app, { isPackaged: true, getVersion: () => '1.3.8', quit: () => calls.push('quit') });
  Object.assign(updater, {
    setFeedURL: () => {},
    checkForUpdates: async () => { updater.emit('checking-for-update'); updater.emit('update-available', { version: '1.3.9' }); },
    downloadUpdate: async () => { updater.emit('download-progress', { percent: 45 }); updater.emit('update-downloaded', { version: '1.3.9', downloadedFile: 'validated-installer.exe' }); return ['validated-installer.exe']; },
    quitAndInstall: (...args) => calls.push(args),
  });
  const win = { isDestroyed: () => false, webContents: { send: () => {} } };
  const shell = { openPath: async path => { calls.push(path); return ''; }, openExternal: async url => calls.push(url) };
  const api = setup({ app, updater, shell, portable, schedule: false, getWindow: () => win, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } });
  return { api, updater, app, calls, handlers, win, shell };
}

test('updates require explicit download and installation; checks and downloads are deduplicated', async () => {
  const h = harness();
  assert.equal(h.updater.autoDownload, false); assert.equal(h.updater.autoInstallOnAppQuit, false);
  assert.equal(h.updater.allowDowngrade, false); assert.equal(h.updater.allowPrerelease, false);
  let checks = 0, resolve;
  h.updater.checkForUpdates = () => { checks++; return new Promise(r => { resolve = r; }); };
  const first = h.api.check(), second = h.api.check();
  assert.equal(first, second); await Promise.resolve(); assert.equal(checks, 1);
  h.updater.emit('update-available', { version: '1.3.9' }); resolve(); await first;
  let downloads = 0;
  const download = h.updater.downloadUpdate;
  h.updater.downloadUpdate = async () => { downloads++; return download(); };
  await Promise.all([h.api.download(), h.api.download()]); assert.equal(downloads, 1);
  assert.equal(h.api.getState().status, 'downloaded'); assert.deepEqual(h.calls, []);
  await h.api.check(); assert.equal(checks, 1);
  await h.api.install(); await h.api.install(); assert.deepEqual(h.calls, [[false, true]]);
});

test('network errors are handled, checks can retry, and unavailable releases cannot install', async () => {
  const h = harness();
  h.updater.checkForUpdates = async () => { h.updater.emit('error', new Error('network')); throw new Error('network'); };
  await h.api.check(); assert.equal(h.api.getState().status, 'error');
  await h.api.install(); assert.deepEqual(h.calls, []);
  h.updater.checkForUpdates = async () => h.updater.emit('update-not-available');
  await h.api.check(); assert.equal(h.api.getState().status, 'up-to-date');
  await h.api.download(); assert.deepEqual(h.calls, []);
});

test('failed or invalid downloads never enable installation; download retry succeeds', async () => {
  const h = harness(); await h.api.check();
  const download = h.updater.downloadUpdate;
  h.updater.downloadUpdate = async () => { throw new Error('SHA512 mismatch'); };
  await h.api.download(); assert.equal(h.api.getState().status, 'error');
  await h.api.install(); assert.deepEqual(h.calls, []);
  h.updater.downloadUpdate = download; await h.api.download();
  assert.equal(h.api.getState().status, 'downloaded');
});

test('portable installer launch failure retains app and permits retry', async () => {
  const h = harness(true); await h.api.check(); await h.api.download();
  h.shell.openPath = async () => 'launch failed';
  await h.api.install(); assert.equal(h.api.getState().status, 'error'); assert.deepEqual(h.calls, []);
  await h.api.download(); h.shell.openPath = async path => { h.calls.push(path); return ''; };
  await h.api.install(); assert.deepEqual(h.calls, ['validated-installer.exe', 'quit']);
});

test('update IPC rejects untrusted embedded web contents and permits the main renderer', async () => {
  const h = harness();
  assert.throws(() => h.handlers.get('updater:install')({ sender: {} }), /Unauthorized/);
  await h.handlers.get('updater:check')({ sender: h.win.webContents });
  assert.equal(h.api.getState().status, 'available');
});

test('development mode never contacts the update service', async () => {
  const h = harness(); h.app.isPackaged = false;
  h.updater.checkForUpdates = async () => { throw new Error('must not be called'); };
  await h.api.check(); assert.match(h.api.getState().error, /开发模式/);
});
