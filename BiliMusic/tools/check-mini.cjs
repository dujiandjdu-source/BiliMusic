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


(async()=>{
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[bootstrap]});
 try{
  await app.firstWindow();let page;
  for(let i=0;i<100&&!page;i++){page=app.windows().find(p=>p.url().startsWith('file:'));if(!page)await new Promise(r=>setTimeout(r,100));}
  let server;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('input[accept="audio/*,.lrc,.txt"]'));
  const wav=Buffer.alloc(44+16000*2*30);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const files=['Rule Breaker','Wonder Light','Wonder Light (instrumental)','Duel for Real','The Last Dambuster','A very long song title that should stay on one line'].map(title=>{const file=path.join(profile,'BlackWings Audio - '+title+'.wav');fs.writeFileSync(file,wav);return file;});
  await page.locator('input[accept="audio/*,.lrc,.txt"]').setInputFiles(files);
  await page.waitForFunction(()=>document.querySelector('audio')?.paused===false);
  await page.waitForFunction(async()=> (await window.electronAPI.desktop.getState()).queue?.length===6);
  await page.evaluate(()=>window.electronAPI.desktop.command('restore'));
  const ready=app.waitForEvent('window');await page.evaluate(()=>window.electronAPI.desktop.openMini());const mini=await ready;mini.on('pageerror',e=>errors.push(e.message));
  await mini.waitForURL('**/*panel=mini');await mini.locator('.mini-row').nth(5).waitFor();
  const miniBounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('panel=mini')).getBounds());
  assert.equal((await miniBounds()).height,310);
  assert.equal(await mini.locator('audio').count(),0);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('panel=')).isVisible()),false,'opening mini hides the main window');
  assert.equal(await mini.locator('.mini-header').evaluate(e=>getComputedStyle(e).webkitAppRegion),'no-drag');
  assert.equal(await mini.locator('.mini-cover').evaluate(e=>getComputedStyle(e).webkitAppRegion),'no-drag');
  await mini.screenshot({path:path.join(profile,'compact-idle.png')});
  await mini.getByRole('button',{name:'恢复主窗口',exact:true}).focus();
  await mini.screenshot({path:path.join(profile,'compact-controls.png')});
  await mini.getByRole('button',{name:'暂停',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').paused);
  await mini.getByRole('button',{name:'显示播放队列'}).click();await mini.waitForFunction(()=>window.innerHeight===108);assert.equal((await miniBounds()).height,108);await mini.locator('.mini-queue').waitFor({state:'detached'});
  await mini.getByRole('button',{name:'显示播放队列'}).click();await mini.waitForFunction(()=>window.innerHeight===310);assert.equal((await miniBounds()).height,310);
  await mini.locator('.mini-row-title').nth(2).click();await page.waitForFunction(async()=> (await window.electronAPI.desktop.getState()).title==='Wonder Light (instrumental)' && !document.querySelector('audio').paused);
  await mini.waitForFunction(()=>document.querySelector('.mini-row.is-current')?.getAttribute('aria-current')==='true' && document.querySelector('.mini-row.is-current')?.textContent.includes('Wonder Light (instrumental)'));
  const row=mini.locator('.mini-row').nth(2);
  await row.getByRole('button',{name:'暂停 Wonder Light (instrumental)',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').paused);
  await row.getByRole('button',{name:'播放 Wonder Light (instrumental)',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('audio').paused);
  await row.locator('.mini-row-title').focus();
  await row.getByRole('button',{name:'喜欢 Wonder Light (instrumental)',exact:true}).click();
  await mini.waitForFunction(()=>document.querySelectorAll('.mini-row')[2].querySelector('[aria-pressed]').getAttribute('aria-pressed')==='true');
  await row.getByRole('button',{name:'更多 Wonder Light (instrumental)',exact:true}).click();
  await mini.getByRole('menuitem',{name:'迷你窗口置顶'}).click();
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('panel=mini')).isAlwaysOnTop()),false);
  const current=await page.evaluate(()=>window.electronAPI.desktop.getState());await mini.evaluate(()=>window.electronAPI.desktop.command({action:'play-song',songId:'missing-id'}));await page.waitForTimeout(150);assert.equal((await page.evaluate(()=>window.electronAPI.desktop.getState())).songId,current.songId);
  await mini.locator('.mini-row-title').nth(5).click();
  await mini.waitForFunction(()=>{const list=document.querySelector('.mini-queue'),row=document.querySelector('.mini-row.is-current');return row?.textContent.includes('A very long song title') && list.scrollTop>0 && row.getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom;});
  await mini.getByRole('button',{name:'恢复主窗口',exact:true}).focus();
  await mini.getByRole('button',{name:'下一首',exact:true}).click();
  await mini.waitForFunction(()=>document.querySelector('.mini-row.is-current')?.textContent.includes('Rule Breaker') && document.querySelector('.mini-queue').scrollTop===0);
  await mini.getByRole('button',{name:'上一首',exact:true}).click();
  await mini.waitForFunction(()=>document.querySelector('.mini-row.is-current')?.textContent.includes('A very long song title') && document.querySelector('.mini-queue').scrollTop>0);
  await mini.getByRole('button',{name:'恢复主窗口',exact:true}).focus();await mini.getByRole('button',{name:'显示播放队列'}).click();await mini.waitForFunction(()=>window.innerHeight===108);
  await mini.screenshot({path:path.join(profile,'compact-collapsed.png'),omitBackground:true});
  assert.equal(await mini.locator('.mini-card').evaluate(e=>getComputedStyle(e).borderRadius),'22px');
  await mini.getByRole('button',{name:'显示播放队列'}).click();await mini.waitForFunction(()=>window.innerHeight===310);
  await mini.waitForFunction(()=>{const list=document.querySelector('.mini-queue'),row=document.querySelector('.mini-row.is-current');return list && row && list.scrollTop>0 && row.getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom;});
  await mini.locator('.mini-row-title').nth(5).focus();assert.equal(await mini.locator('.mini-row-title').nth(5).evaluate(e=>e.getBoundingClientRect().right<=window.innerWidth),true);
  await mini.screenshot({path:path.join(profile,'compact-queue.png')});
  for(let i=0;i<3;i++) {
    await mini.getByRole('button',{name:'恢复主窗口',exact:true}).focus();
    await mini.getByRole('button',{name:'显示播放队列'}).click();await mini.waitForFunction(()=>window.innerHeight===108);
    assert.equal((await miniBounds()).height,108);
    await mini.getByRole('button',{name:'显示播放队列'}).click();await mini.waitForFunction(()=>window.innerHeight===310);
    assert.equal((await miniBounds()).height,310);
  }
  await page.evaluate(()=>window.electronAPI.win.close());await mini.getByRole('button',{name:'恢复主窗口',exact:true}).click();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('panel=')).isVisible()),true);
  let requests=0;
  server=require('node:http').createServer((request,response)=>{if(request.url==='/netease-meta'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({code:200,data:[{url:'http://127.0.0.1:'+server.address().port+'/netease.wav'}]}));return;}if(request.url==='/netease.wav'){response.writeHead(200,{'Content-Type':'audio/wav','Content-Length':wav.length,'Access-Control-Allow-Origin':'*'});response.end(wav);return;}requests++;response.setHeader('Access-Control-Allow-Origin','*');if(requests===1){response.writeHead(503,{'Content-Type':'text/plain'});response.end('temporary failure');}else{response.writeHead(200,{'Content-Type':'audio/wav','Content-Length':wav.length});response.end(wav);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const serialized=await page.evaluate(()=>['netease-audio://play/5000000000?quality=standard','netease-audio://22786083?quality=standard'].map(url=>{const audio=new Audio();audio.src=url;return audio.src;}));
    const ids=await app.evaluate(({app},urls)=>{const parser=process.mainModule.require(app.getAppPath()+'/electron/ipc/netease.js')._test.parseAudioSongId;return urls.map(parser);},serialized);
    assert.deepEqual(ids,['5000000000','22786083']);
    console.log('PASS Chromium preserves large Netease IDs and recovers legacy numeric-host URLs');
    await page.evaluate(url=>{const audio=document.querySelector('audio');audio.src=url;audio.load();},'http://127.0.0.1:'+server.address().port+'/recovery.wav');
    await page.waitForFunction(()=>document.querySelector('audio').error && document.body.innerText.includes('音源不可用'));
    await mini.getByRole('button',{name:'恢复主窗口',exact:true}).focus();
    await mini.getByRole('button',{name:'播放',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('audio').paused && document.querySelector('audio').currentTime>0.1 && !document.querySelector('audio').error);
    assert.ok(requests>=2,'explicit play requests a fresh stream after media failure');
    console.log('PASS real Chromium media failure followed by successful retry');
  } finally {server.closeAllConnections();server.close();}
  const mainBefore=await page.evaluate(()=>window.electronAPI.win.getPosition());
  const before=await mini.evaluate(()=>window.electronAPI.win.getPosition());
  await mini.mouse.move(200,90);await mini.mouse.down();await mini.waitForTimeout(80);await mini.mouse.move(240,115,{steps:4});await mini.waitForTimeout(120);await mini.mouse.up();
  assert.notDeepEqual(await mini.evaluate(()=>window.electronAPI.win.getPosition()),before,'drag moves mini window');
  assert.deepEqual(await page.evaluate(()=>window.electronAPI.win.getPosition()),mainBefore,'mini drag leaves main window in place');
  await mini.mouse.move(350,305);

  assert.deepEqual(errors,[]);
  console.log('PASS real mini queue, click-to-play, per-song likes, collapse/expand native bounds, topmost menu, restore, invalid IDs, truncation, single audio owner');console.log('QA screenshots: '+profile);
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
