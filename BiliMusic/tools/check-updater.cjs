// Validate the real Electron updater against an isolated HTTP release feed.
// Installation is intercepted so QA never changes the user's installed app.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const appPath = path.resolve(process.argv[3] || root);
const installer = fs.readFileSync(process.argv[4]);
const hash = crypto.createHash('sha512').update(installer).digest('base64');
let corrupt = true;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/latest.yml')) {
    res.end(`version: 1.3.9\nfiles:\n  - url: BiliMusic-Setup-1.3.9.exe\n    sha512: ${corrupt ? Buffer.alloc(64).toString('base64') : hash}\n    size: ${installer.length}\npath: BiliMusic-Setup-1.3.9.exe\nsha512: ${corrupt ? Buffer.alloc(64).toString('base64') : hash}\nreleaseDate: '2026-10-10T00:00:00.000Z'\n`);
  } else if (req.url.startsWith('/BiliMusic-Setup-1.3.9.exe')) {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installer.length });
    res.end(installer);
  } else { res.writeHead(404); res.end(); }
});

async function verify(portable) {
  corrupt = true;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bilimusic-update-qa-'));
  const cache = path.join(profile, 'cache'); fs.mkdirSync(cache);
  const bootstrap = path.join(profile, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `
const electron=require('electron'),{app}=electron;
app.setPath('userData',${JSON.stringify(profile)});app.setPath('cache',${JSON.stringify(cache)});
app.setAppPath(${JSON.stringify(appPath)});app.getVersion=()=> '1.3.8';
Object.defineProperty(app,'isPackaged',{get:()=>true});
${portable ? "process.env.PORTABLE_EXECUTABLE_FILE='isolated-portable.exe';" : "delete process.env.PORTABLE_EXECUTABLE_FILE;"}
const RealWindow=electron.BrowserWindow;
const TestWindow=new Proxy(RealWindow,{construct(Target,args){return new Target({...args[0],show:false});}});
const shadow=Object.create(electron);Object.defineProperty(shadow,'BrowserWindow',{value:TestWindow});
const Module=require('module'),original=Module._load;Module._load=function(n,...a){return n==='electron'?shadow:original.call(this,n,...a);};
const {autoUpdater}=require(${JSON.stringify(path.join(root,'node_modules/electron-updater'))});
Object.defineProperty(autoUpdater.app,'baseCachePath',{get:()=>${JSON.stringify(cache)}});
const loadWithElectron=Module._load;Module._load=function(n,...a){return n==='electron-updater'?{autoUpdater}:loadWithElectron.call(this,n,...a);};
autoUpdater.updateConfigPath=${JSON.stringify(path.join(path.dirname(appPath), 'app-update.yml'))};
autoUpdater.disableDifferentialDownload=true;
global.updateInstallCalls=[];
autoUpdater.quitAndInstall=(...args)=>global.updateInstallCalls.push({action:'installed',args});
electron.shell.openPath=async p=>{global.updateInstallCalls.push({action:'portable',path:p});return '';};
global.updateOriginalQuit=app.quit.bind(app);app.quit=()=>global.updateInstallCalls.push({action:'quit'});
require(${JSON.stringify(path.join(appPath,'electron/main.cjs'))});
app.whenReady().then(()=>autoUpdater.setFeedURL({provider:'generic',url:'http://127.0.0.1:${server.address().port}/'}));
`);
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap] });
  app.process().stderr.on('data', data => { const message = data.toString(); if (/updat|sha512|checksum/i.test(message)) console.log(message.trim()); });
  try {
    await app.firstWindow();
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find(window => window.url().startsWith('file:'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page, 'main renderer exists');
    await page.waitForFunction(() => document.querySelector('.ios-sidebar button'));
    await page.addStyleTag({ content: '* { transition: none !important; }' });
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');
    await page.getByTitle('设置', { exact: true }).first().click();
    await page.getByRole('button', { name: '关于', exact: true }).click();
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await page.getByRole('button', { name: '下载更新', exact: true }).waitFor();
    console.log('PASS update check', portable ? 'portable' : 'installed');
    assert.equal((await page.evaluate(() => window.electronAPI.updater.getState())).portable, portable);
    await page.getByRole('button', { name: '下载更新', exact: true }).click();
    await page.getByRole('button', { name: '重试检查', exact: true }).waitFor({ timeout: 60000 });
    assert.equal(await page.getByRole('button', { name: '退出并安装', exact: true }).count(), 0);
    assert.deepEqual(await app.evaluate(() => global.updateInstallCalls), []);
    corrupt = false;
    await page.getByRole('button', { name: '重试检查', exact: true }).click();
    await page.getByRole('button', { name: '下载更新', exact: true }).click();
    await page.getByRole('button', { name: '退出并安装', exact: true }).waitFor({ timeout: 60000 });
    const downloaded = await app.evaluate((_, modulePath) => process.mainModule.require(modulePath).autoUpdater.installerPath, path.join(root, 'node_modules/electron-updater'));
    assert.equal(crypto.createHash('sha512').update(fs.readFileSync(downloaded)).digest('base64'), hash);
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');
    await page.getByTitle('设置', { exact: true }).first().click();
    await page.getByRole('button', { name: '关于', exact: true }).click();
    await page.getByRole('button', { name: '退出并安装', exact: true }).click();
    await page.waitForFunction(async () => (await window.electronAPI.updater.getState()).status === 'installing');
    const calls = await app.evaluate(() => global.updateInstallCalls);
    if (portable) { assert.equal(calls[0].path, downloaded); assert.equal(calls[1].action, 'quit'); }
    else { assert.deepEqual(calls, [{ action: 'installed', args: [false, true] }]); }
    console.log('PASS', portable ? 'portable' : 'installed', 'real download, SHA512 rejection/retry, persisted update UI and installer handoff (launch intercepted)');
  } finally { await app.evaluate(({app}) => { app.quit = global.updateOriginalQuit; }).catch(() => {}); await app.close(); }
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await verify(false); await verify(true); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
