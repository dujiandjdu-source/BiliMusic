// Run with: node tools/check-desktop.cjs <playwright-module-path> [app-directory]
// All application storage is isolated in a new temporary directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
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
const {autoUpdater}=require(${JSON.stringify(path.join(root,'node_modules/electron-updater'))});autoUpdater.checkForUpdates=async()=>{autoUpdater.emit('update-not-available');return null;};
const updateModule=require('module'),updateLoad=updateModule._load;updateModule._load=function(n,...a){return n==='electron-updater'?{autoUpdater}:updateLoad.call(this,n,...a);};
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
    const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('RENDERER ERROR',e.stack); });
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
    await page.getByRole('button',{name:'隐藏浏览工具栏',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('input[placeholder="输入 B 站链接..."]').getClientRects().length);
    const viewBounds=()=>electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBrowserViews()[0].getBounds());
    assert.equal((await viewBounds()).x,4);assert.equal((await viewBounds()).y,4);
    await page.locator('[aria-label="显示浏览工具栏"]').dispatchEvent('mouseover');
    await input.waitFor({state:'visible'});assert.equal((await viewBounds()).x,48);assert.equal((await viewBounds()).y,36);
    await page.getByRole('button',{name:'隐藏浏览工具栏',exact:true}).click();
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');
    await input.waitFor({state:'visible'});
    console.log('PASS browser hides both toolbars, expands native view and reveals from top or left edge');
    console.log('PASS sidebar, about version, video address bar and reload');
    await page.locator('button[title="切换音乐模式"]').click();
    const wav = Buffer.alloc(44+16000*2*10);
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
    wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
    wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    for (let i = 0; i < 16000 * 10; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 16000) * 12000), 44 + i * 2);
    const audioFile=path.join(profile,'Artist - Desktop test.wav');fs.writeFileSync(audioFile,wav);
    const lyricFile=path.join(profile,'Artist - Desktop test.lrc');fs.writeFileSync(lyricFile,'[00:00.00]desktop lyric\n[00:05.00]second line');
    await page.locator('input[accept="audio/*,.lrc,.txt"]').setInputFiles([audioFile,lyricFile]);
    await page.waitForFunction(()=>document.querySelector('audio')?.paused===false);
    const audible = await page.evaluate(async () => {
      const audio = document.querySelector('audio');
      if (!audio?.captureStream) return true;
      const context = new AudioContext(); await context.resume();
      const source = context.createMediaStreamSource(audio.captureStream());
      const analyser = context.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
      await new Promise(resolve => setTimeout(resolve, 250));
      const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
      source.disconnect(); await context.close();
      return data.some(value => Math.abs(value) > 0.01);
    });
    assert.equal(audible, true, 'decoded audio produces a non-silent signal');
    await page.waitForFunction(()=>document.body?.innerText.includes('Desktop test'));
    await page.waitForTimeout(400);await page.reload();
    await page.waitForFunction(()=>document.body?.innerText.includes('Desktop test'));
    assert.equal(await page.evaluate(()=>document.querySelector('audio').src.startsWith('blob:')),true);
    console.log('PASS local import, playback and IndexedDB reload');
    await page.addStyleTag({ content: '* { transition: none !important; }' });
    await page.locator('button[title="队列"],button[title="Queue"]').click();
    await page.locator('button[title="喜欢"]').click({force:true});
    await page.locator('button[title="收藏"]').click({force:true});
    await page.locator('button[title="删除"]').click({force:true});
    const readSnapshot = () => page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('bili-music', 1);
      request.onerror = reject;
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('meta');
        const get = tx.objectStore('meta').get('playlist');
        get.onsuccess = () => resolve(get.result); get.onerror = reject;
        tx.oncomplete = () => db.close();
      };
    }));
    await page.waitForTimeout(400);
    let snapshot = await readSnapshot();
    assert.equal(snapshot.queue.length, 0); assert.equal(snapshot.songs.length, 1);
    assert.equal(snapshot.library.likedSongIds.length, 1); assert.equal(snapshot.library.favoriteSongIds.length, 1);
    await page.reload(); await page.addStyleTag({ content: '* { transition: none !important; }' });
    await page.waitForTimeout(400); snapshot = await readSnapshot();
    assert.equal(snapshot.queue.length, 0); assert.equal(snapshot.songs.length, 1);
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover'); await page.waitForTimeout(300);
    await page.locator('button[title="设置"]').first().click();
    await page.getByRole('button', {name:'音乐库 · 1',exact:true}).click();
    assert.equal(await page.getByRole('button', {name:'播放',exact:true}).evaluate(e=> {
      const dialog=e.closest('[role="dialog"]') || e.closest('section').parentElement;
      const bounds=e.getBoundingClientRect(), container=dialog.getBoundingClientRect();
      return bounds.x>=container.x && bounds.right<=container.right;
    }),true,'catalog actions fit within the panel');
    await page.screenshot({path:path.join(profile,'music-library.png')});
    await page.getByRole('button', {name:'播放',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('audio')?.paused===false);
    await page.getByRole('button', {name:'关闭设置',exact:true}).click();
    console.log('PASS empty queue restart retains catalog, likes, favorites and playable local file');
    const miniReady = electron.waitForEvent('window');
    await page.evaluate(()=>window.electronAPI.desktop.openMini());
    const miniPage = await miniReady;
    await miniPage.waitForURL('**/*panel=mini');
    assert.ok(miniPage, 'mini renderer exists');
    await miniPage.getByText('Desktop test',{exact:true}).waitFor();
    await miniPage.screenshot({path:path.join(profile,'mini-player.png')});
    await miniPage.getByRole('button',{name:'恢复主窗口',exact:true}).focus();
    console.log('QA screenshots: '+profile);
    assert.equal(await miniPage.locator('audio').count(),0,'auxiliary window has no audio player');
    await miniPage.getByRole('button',{name:'暂停',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('audio')?.paused===true);
    await page.waitForTimeout(300); snapshot = await readSnapshot();
    const playCount = snapshot.library.playHistory[0].playCount;
    assert.ok(playCount >= 2); assert.ok(snapshot.library.playHistory[0].lastPlayedAt > 0);
    await miniPage.getByRole('button',{name:'播放',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('audio')?.paused===false);
    await page.waitForTimeout(300);
    assert.equal((await readSnapshot()).library.playHistory[0].playCount,playCount,'resume does not count another play');
    await miniPage.getByRole('button',{name:'下一首',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('audio')?.paused===false);
    await page.waitForTimeout(250);
    assert.equal((await readSnapshot()).library.playHistory[0].playCount,playCount+1,'single-song next records an actual new playback visit');
    await miniPage.getByRole('button',{name:'迷你窗口置顶'}).click();
    assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('panel=mini')).isAlwaysOnTop()),false);
    await page.evaluate(()=>{document.querySelector('audio').currentTime=0;return window.electronAPI.win.close();});
    assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('panel=mini')).isVisible()),false);
    const backgroundTime = await page.evaluate(()=>document.querySelector('audio').currentTime);
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(()=>document.querySelector('audio').currentTime)>backgroundTime,'hidden main window continues playback');
    await miniPage.getByRole('button',{name:'恢复主窗口'}).click();
    assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('panel=mini')).isVisible()),true);
    await miniPage.getByRole('button',{name:'关闭迷你播放器'}).click();
    console.log('PASS mini playback, topmost toggle, close-to-tray, background audio, restore and play history');
    await page.evaluate(async()=>{const state=await window.electronAPI.desktop.getState();if(state.isPlaying)await window.electronAPI.desktop.command('toggle');});
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover'); await page.waitForTimeout(250);
    await page.locator('button[title="设置"]').first().click();
    await page.getByRole('button',{name:'播放设置',exact:true}).click();
    await page.getByLabel('歌词延后秒数').fill('2');
    if (process.argv.includes('--online')) {
      await page.getByLabel('搜索匹配歌词').fill('晴天');
      await page.getByRole('button',{name:'搜索歌词',exact:true}).click();
      await page.getByRole('button',{name:/^晴天 ·/}).first().click();
      await page.getByText('歌词匹配已保存',{exact:true}).waitFor();
      await page.waitForTimeout(250);snapshot=await readSnapshot();
      assert.match(snapshot.songs[0].lyricsSourceId,/^\d+$/);assert.ok(snapshot.songs[0].lyrics.length>5);
      console.log('PASS live Netease lyric search, explicit selection and persisted source ID');
    }
    const calibratedFile=path.join(profile,'calibrated.lrc');fs.writeFileSync(calibratedFile,'[00:00.00]calibrated line\n[00:04.00]next line');
    await page.getByLabel('导入校准歌词').setInputFiles(calibratedFile);
    await page.getByText('歌词已导入并保存',{exact:true}).waitFor();
    const lyricsReady=electron.waitForEvent('window');
    await page.getByRole('button',{name:'打开桌面歌词',exact:true}).click();
    const lyricsPage=await lyricsReady; await lyricsPage.waitForURL('**/*panel=lyrics');
    lyricsPage.on('pageerror',e=>errors.push(e.message));
    assert.equal(await lyricsPage.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
    await page.evaluate(()=>{const audio=document.querySelector('audio');audio.currentTime=1;audio.dispatchEvent(new Event('timeupdate'));});
    await lyricsPage.getByTestId('desktop-lyric').filter({hasText:'Desktop test'}).waitFor();
    await page.evaluate(()=>{const audio=document.querySelector('audio');audio.currentTime=2.5;audio.dispatchEvent(new Event('timeupdate'));});
    await lyricsPage.getByTestId('desktop-lyric').filter({hasText:'calibrated line'}).waitFor();
    await page.getByLabel('桌面歌词字号').fill('42'); await page.getByLabel('歌词颜色',{exact:true}).fill('#00ff00');
    await lyricsPage.waitForFunction(()=>getComputedStyle(document.querySelector('[data-testid="desktop-lyric"]')).fontSize==='42px');
    assert.equal(await lyricsPage.getByTestId('desktop-lyric').evaluate(e=>getComputedStyle(e).color),'rgb(0, 255, 0)');
    await electron.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('panel=lyrics'));
      const ignore=win.setIgnoreMouseEvents.bind(win);win.setIgnoreMouseEvents=(...args)=>{global.biliCheckIgnore=args;return ignore(...args);};
    });
    await page.getByLabel('锁定位置',{exact:true}).check(); await page.getByLabel('鼠标穿透',{exact:true}).check();
    await page.waitForFunction(async()=> (await window.electronAPI.desktop.getLyricsPreferences()).clickThrough);
    assert.deepEqual(await electron.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('panel=lyrics'));
      return {movable:win.isMovable(),topmost:win.isAlwaysOnTop(),ignore:global.biliCheckIgnore};
    }),{movable:false,topmost:true,ignore:[true,{forward:true}]});
    await page.evaluate(()=>window.electronAPI.desktop.unlockLyrics());
    await page.getByLabel('鼠标穿透',{exact:true}).waitFor();
    await page.waitForFunction(async()=>!(await window.electronAPI.desktop.getLyricsPreferences()).clickThrough);
    await lyricsPage.screenshot({path:path.join(profile,'desktop-lyrics.png'),omitBackground:true});
    await page.screenshot({path:path.join(profile,'playback-settings.png')});
    await page.waitForTimeout(300);snapshot=await readSnapshot();
    assert.equal(snapshot.songs[0].lyricsOffset,2);assert.equal(snapshot.songs[0].lyricsManual,true);
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    await page.reload(); await page.addStyleTag({content:'* {transition:none !important;}'});
    await page.waitForFunction(()=>document.body.innerText.includes('Desktop test'));
    await page.evaluate(()=>{const audio=document.querySelector('audio');audio.currentTime=2.5;audio.dispatchEvent(new Event('timeupdate'));});
    await lyricsPage.getByTestId('desktop-lyric').filter({hasText:'calibrated line'}).waitFor();
    snapshot=await readSnapshot();assert.equal(snapshot.songs[0].lyricsOffset,2);assert.equal(snapshot.library.preferences.desktopLyrics.fontSize,42);
    console.log('PASS imported lyrics, calibrated desktop timing, transparency, font/color, lock, click-through, unlock and restart persistence');
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');await page.waitForTimeout(250);
    await page.locator('button[title="设置"]').first().click();await page.getByRole('button',{name:'播放设置',exact:true}).click();
    const hotkey='Control+Alt+Shift+F10';
    // Leave the user's running player alone; reserve only this test's unique binding.
    for (const action of ['上一首','下一首','收藏 / 取消收藏']) {
      await page.getByLabel('全局快捷键 '+action,{exact:true}).fill('');
    }
    await page.getByLabel('全局快捷键 播放 / 暂停',{exact:true}).fill(hotkey);
    await page.getByRole('button',{name:'应用快捷键',exact:true}).click();
    await page.waitForTimeout(300);
    assert.equal(await electron.evaluate(({globalShortcut},key)=>globalShortcut.isRegistered(key),hotkey),true,
      JSON.stringify({ input: await page.getByLabel('全局快捷键 播放 / 暂停',{exact:true}).inputValue(),
        saved: (await readSnapshot()).library.preferences.shortcuts, notices: await page.locator('[role="status"]').allTextContents() }));
    const occupied='Control+Alt+Shift+F9';
    assert.equal(await electron.evaluate(({globalShortcut},key)=>globalShortcut.register(key,()=>{}),occupied),true);
    await page.getByLabel('全局快捷键 播放 / 暂停',{exact:true}).fill(occupied);
    await page.getByRole('button',{name:'应用快捷键',exact:true}).click();
    const conflictNotice = page.getByText(/快捷键被占用或无效：Control\+Alt\+Shift\+F9/);
    await conflictNotice.waitFor();await page.waitForTimeout(250);
    assert.equal(await conflictNotice.count(),1,'conflict creates one error notice without rerender loops');
    assert.equal((await readSnapshot()).library.preferences.shortcuts.toggle,hotkey,'conflict does not persist rejected settings');
    assert.equal(await electron.evaluate(({globalShortcut},key)=>globalShortcut.isRegistered(key),hotkey),true);
    await electron.evaluate(({globalShortcut},key)=>globalShortcut.unregister(key),occupied);
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    await page.evaluate(()=>window.electronAPI.win.close());
    const wasPaused=await page.evaluate(()=>document.querySelector('audio').paused);
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public class BiliKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, System.UIntPtr info); }\'; '+
      '[BiliKeys]::keybd_event(17,0,0,[UIntPtr]::Zero);[BiliKeys]::keybd_event(18,0,0,[UIntPtr]::Zero);[BiliKeys]::keybd_event(16,0,0,[UIntPtr]::Zero);[BiliKeys]::keybd_event(121,0,0,[UIntPtr]::Zero);'+
      '[BiliKeys]::keybd_event(121,0,2,[UIntPtr]::Zero);[BiliKeys]::keybd_event(16,0,2,[UIntPtr]::Zero);[BiliKeys]::keybd_event(18,0,2,[UIntPtr]::Zero);[BiliKeys]::keybd_event(17,0,2,[UIntPtr]::Zero);'
    ],{windowsHide:true,timeout:15000});
    await page.waitForFunction(paused=>document.querySelector('audio').paused!==paused,wasPaused);
    await page.evaluate(()=>window.electronAPI.desktop.command('restore'));
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');await page.waitForTimeout(250);
    await page.locator('button[title="设置"]').first().click();await page.getByRole('button',{name:'播放设置',exact:true}).click();
    await page.getByRole('button',{name:'15 分钟',exact:true}).click();
    await page.getByText(/将在 .* 暂停/).waitFor();
    await page.getByRole('button',{name:'取消定时',exact:true}).click();
    await page.getByText('未开启定时停止',{exact:true}).waitFor();
    await page.getByRole('button',{name:'当前歌曲播完停止',exact:true}).click();
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    await page.evaluate(()=>{const audio=document.querySelector('audio');audio.currentTime=audio.duration-0.2;});
    await page.waitForFunction(()=>document.querySelector('audio').paused===true && document.querySelector('audio').ended===true);
    await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>document.querySelector('audio').paused),true);
    await lyricsPage.getByRole('button',{name:'关闭桌面歌词'}).click({force:true});
    console.log('PASS customized native global hotkey with hidden main window and after-song sleep stop');
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
