// Run with: node tools/check-desktop.cjs <playwright-module-path> [app-directory]
// All application storage is isolated in a new temporary directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const appDirectory = path.resolve(process.argv[3] || root);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bilimusic-desktop-check-'));
const bootstrap = path.join(profile, 'bootstrap.cjs');
fs.writeFileSync(bootstrap, `
const electron=require('electron'),{app}=electron;
app.setPath('userData',${JSON.stringify(profile)});
app.setAppPath(${JSON.stringify(appDirectory)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
const RealWindow=electron.BrowserWindow;
const TestWindow=new Proxy(RealWindow,{construct(Target,args){return new Target({...args[0],show:false});}});
const shadow=Object.create(electron);Object.defineProperty(shadow,'BrowserWindow',{value:TestWindow});
const Module=require('module'),original=Module._load;Module._load=function(n,...a){return n==='electron'?shadow:original.call(this,n,...a);};
const {autoUpdater}=require(${JSON.stringify(path.join(root,'node_modules/electron-updater'))});autoUpdater.checkForUpdatesAndNotify=async()=>null;
require(${JSON.stringify(path.join(appDirectory,'electron/main.cjs'))});
`);

(async () => {
  const electron = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [bootstrap] });
  try {
    await electron.firstWindow();
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = electron.windows().find(p => p.url().startsWith('file:'));
      if (!page) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(page, 'main renderer exists');
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => document.body?.innerText.includes('BiliMusic'));
    // Chromium does not composite CSS transitions for hidden test windows.
    await page.addStyleTag({ content: '* { transition: none !important; }' });
    const region = page.locator('div[aria-hidden="true"].z-\\[998\\]');
    assert.equal(await region.evaluate(e => getComputedStyle(e).webkitAppRegion), 'no-drag');
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setPosition(100,100));
    const before = await page.evaluate(() => window.electronAPI.win.getPosition());
    await page.mouse.move(300, 15); await page.mouse.down(); await page.waitForTimeout(100);
    await page.mouse.move(380, 55, { steps: 4 }); await page.waitForTimeout(200); await page.mouse.up();
    const after = await page.evaluate(() => window.electronAPI.win.getPosition());
    assert.notDeepEqual(after, before, 'pointer drag changes native window position');
    console.log('PASS native window drag', before, after);
    await page.evaluate(() => window.electronAPI.win.maximize());
    await page.waitForFunction(() => window.electronAPI.win.isMaximized());
    await page.evaluate(() => window.electronAPI.win.maximize());
    await page.waitForFunction(async () => !(await window.electronAPI.win.isMaximized()));
    console.log('PASS maximize and restore');
    // Hidden automation windows have no OS hover tracking; dispatch the actual hover handler.
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');
    await page.waitForTimeout(300);
    const settings = page.locator('button[title="设置"]').first();
    assert.ok((await settings.boundingBox()).x >= 0, 'sidebar opens');
    const sidebarBefore = await page.evaluate(() => window.electronAPI.win.getPosition());
    await page.mouse.move(24,400);await page.mouse.down();await page.waitForTimeout(100);
    await page.mouse.move(44,420);await page.waitForTimeout(100);await page.mouse.up();
    assert.notDeepEqual(await page.evaluate(() => window.electronAPI.win.getPosition()),sidebarBefore,'sidebar blank area drags window');
    await settings.click(); await page.getByRole('button', { name: '关于', exact: true }).click();
    const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
    await page.getByRole('heading',{ name: 'BiliMusic '+version, exact: true }).waitFor();
    await page.getByRole('button',{ name: '关闭设置', exact: true }).click();
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');
    await page.waitForTimeout(300);
    await page.locator('button[title="切换视频模式"]').click();
    const input = page.locator('input[placeholder="输入 B 站链接..."]');
    await input.fill('https://www.bilibili.com/');
    const hit = await input.evaluate(e => { const r=e.getBoundingClientRect(); return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e; });
    assert.equal(hit,true,'video address bar is not covered');
    await page.locator('button[title="刷新"]').click();
    console.log('PASS sidebar, about version, video address bar and reload');
    await page.locator('button[title="切换音乐模式"]').click();
    const wav = Buffer.alloc(44+16000*2*10);
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
    wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    const audioFile=path.join(profile,'Artist - Desktop test.wav');fs.writeFileSync(audioFile,wav);
    const lyricFile=path.join(profile,'Artist - Desktop test.lrc');fs.writeFileSync(lyricFile,'[00:00.00]desktop lyric\n[00:05.00]second line');
    await page.locator('input[accept="audio/*,.lrc,.txt"]').setInputFiles([audioFile,lyricFile]);
    await page.waitForFunction(()=>document.querySelector('audio')?.paused===false);
    await page.waitForFunction(()=>document.body?.innerText.includes('Desktop test'));
    await page.waitForTimeout(400);await page.reload();
    await page.waitForFunction(()=>document.body?.innerText.includes('Desktop test'));
    assert.equal(await page.evaluate(()=>document.querySelector('audio').src.startsWith('blob:')),true);
    console.log('PASS local import, playback and IndexedDB reload');
    await page.evaluate(() => new Promise((resolve,reject) => {
      const req=indexedDB.open('bili-music',1);req.onerror=reject;req.onsuccess=()=>{
        const db=req.result,tx=db.transaction('meta','readwrite');
        const prefix='[异度神剑2/异度之刃2 豪华CD OST]',video=prefix+' - 02-碧空中的乐园';
        tx.objectStore('meta').put({queue:[1,2].map(n=>({id:'bili-title-'+n,
          title:prefix+' - 0'+n+'-'+(n===1?'Xenoblade II':'碧空中的乐园'),
          originalTitle:prefix+' - 0'+n+'-'+(n===1?'Xenoblade II':'碧空中的乐园'),
          biliVideoTitle:video,artist:'WinderC',source:'bilibili',isBilibili:true,
          bvid:'BV1234567890',biliCid:n,lyrics:[{time:0,text:'sample'}]})).concat([1,2].map(n=>({
            id:'generic-'+n,title:'Different Album - '+(n===1?'First Song':'Second Song (Live)'),
            originalTitle:'Different Album - '+(n===1?'First Song':'Second Song (Live)'),
            biliVideoTitle:'Different Album - First Song',artist:'Artist',source:'bilibili',isBilibili:true,
            bvid:'BVgeneric',biliCid:n,lyrics:[{time:0,text:'sample'}],
          })))},'playlist');
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;
      };
    }));
    await page.reload();await page.waitForFunction(()=>document.body?.innerText.includes('Xenoblade II'));
    await page.locator('button[title="队列"],button[title="Queue"]').click();
    const header=page.getByText('[异度神剑2/异度之刃2 豪华CD OST]',{exact:true});
    await header.click();
    await page.getByText('碧空中的乐园',{exact:true}).waitFor();
    assert.equal(await page.getByText('[异度神剑2/异度之刃2 豪华CD OST] - 02-碧空中的乐园',{exact:true}).count(),0);
    await page.getByText('Different Album',{exact:true}).click();
    await page.getByText('Second Song (Live)',{exact:true}).waitFor();
    console.log('PASS compact collection header and child track names restored from old snapshot');
    await page.evaluate(() => new Promise((resolve,reject) => {
      const req=indexedDB.open('bili-music',1);req.onerror=reject;req.onsuccess=()=>{
        const db=req.result,tx=db.transaction('meta','readwrite');
        tx.objectStore('meta').put({queue:[{id:'bad',title:'Recovery test',artist:'artist',source:'remote',origin:'https://example.invalid/audio',lyrics:[null,{text:'valid',time:0,words:[null]}],colors:{bad:true}}]},'playlist');
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;
      };
    }));
    await page.reload();await page.waitForFunction(()=>document.body?.innerText.includes('Recovery test'));
    await page.waitForTimeout(500);assert.deepEqual(errors,[]);
    console.log('PASS malformed snapshot recovery; no renderer errors');
  } finally { await electron.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
