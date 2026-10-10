// Real Electron/IndexedDB backup checks, with an isolated profile and downloads.
// node tools/check-backup.cjs <playwright-module-path> [app-directory]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..'), appDirectory = path.resolve(process.argv[3] || root);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bilimusic-backup-check-'));
const bootstrap = path.join(profile, 'bootstrap.cjs'), downloaded = path.join(profile, 'backup.json');
fs.writeFileSync(bootstrap, `
const electron=require('electron'),{app}=electron;
app.setPath('userData',${JSON.stringify(profile)});app.setAppPath(${JSON.stringify(appDirectory)});
Object.defineProperty(app,'isPackaged',{get:()=>true});
const RealWindow=electron.BrowserWindow;
const shadow=Object.create(electron);Object.defineProperty(shadow,'BrowserWindow',{value:new Proxy(RealWindow,{construct(T,a){return new T({...a[0],show:false});}})});
const Module=require('module'),original=Module._load;Module._load=function(n,...a){return n==='electron'?shadow:original.call(this,n,...a);};
const {autoUpdater}=require(${JSON.stringify(path.join(root,'node_modules/electron-updater'))});autoUpdater.checkForUpdatesAndNotify=async()=>null;
app.whenReady().then(()=>electron.session.defaultSession.on('will-download',(_event,item)=>{
  item.setSavePath(${JSON.stringify(downloaded)});item.on('done',(_event,state)=>{global.backupDownloadState=state;});
}));
require(${JSON.stringify(path.join(appDirectory,'electron/main.cjs'))});
`);

(async()=>{
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[bootstrap]});
  try {
    await app.firstWindow(); let page;
    for(let i=0;i<100&&!page;i++){page=app.windows().find(p=>p.url().startsWith('file:'));if(!page)await new Promise(r=>setTimeout(r,100));}
    assert.ok(page);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>document.body?.innerText.includes('BiliMusic'));
    const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);
    wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    const audio=path.join(profile,'Backup artist - Backup sample.wav');fs.writeFileSync(audio,wav);
    await page.locator('input[accept="audio/*,.lrc,.txt"]').setInputFiles(audio);
    await page.waitForFunction(()=>document.body?.innerText.includes('Backup sample'));await page.waitForTimeout(400);
    const openBackup=async()=>{
      await page.addStyleTag({content:'* { transition: none !important; }'});
      await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');await page.waitForTimeout(100);
      await page.locator('button[title="设置"]').first().click();
      await page.getByRole('button',{name:/^歌单 ·/}).click();
    };
    await openBackup();
    await page.getByRole('button',{name:'导出完整备份',exact:true}).click();
    for(let i=0;i<100;i++){if(await app.evaluate(()=>global.backupDownloadState==='completed'))break;await page.waitForTimeout(100);}
    assert.ok(fs.existsSync(downloaded));const backup=JSON.parse(fs.readFileSync(downloaded,'utf8'));
    assert.equal(backup.snapshot.songs.length,1);assert.equal(backup.files.length,1);
    assert.deepEqual(Buffer.from(backup.files[0].base64,'base64'),wav);
    console.log('PASS actual full backup export includes exact owned audio');
    const readState=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
      const request=indexedDB.open('bili-music',1);request.onerror=reject;request.onsuccess=()=>{
        const db=request.result,tx=db.transaction(['meta','files']),get=tx.objectStore('meta').get('playlist');
        get.onsuccess=()=>{const snapshot=get.result;const f=tx.objectStore('files').get(snapshot.songs[0].id);
          f.onsuccess=()=>resolve({snapshot,bytes:f.result.size});};tx.oncomplete=()=>db.close();tx.onerror=reject;
      };
    }));
    const original=await readState();
    await page.getByLabel('选择完整备份',{exact:true}).setInputFiles(downloaded);
    await page.getByLabel('备份恢复预览',{exact:true}).waitFor();
    await page.getByRole('button',{name:'取消恢复',exact:true}).click();
    assert.deepEqual(await readState(),original);
    console.log('PASS preview cancellation leaves database unchanged');
    const corrupt=path.join(profile,'corrupt.json'),bad=structuredClone(backup);bad.files=[];fs.writeFileSync(corrupt,JSON.stringify(bad));
    await page.getByLabel('选择完整备份',{exact:true}).setInputFiles(corrupt);
    await page.getByText(/缺少本地音频/).waitFor();assert.equal(await page.getByLabel('备份恢复预览',{exact:true}).count(),0);
    assert.deepEqual(await readState(),original);
    console.log('PASS incomplete backup rejected without writes');
    const restored=structuredClone(backup);restored.snapshot.songs[0].title='Restored backup';
    restored.snapshot.songs[0].originalTitle='Restored backup';restored.snapshot.songs[0].lyricsManual=true;restored.snapshot.songs[0].lyricsOffset=2;
    restored.snapshot.songs[0].lyrics=[{time:1,text:'Recovered lyric'}];restored.snapshot.queue=[];
    restored.snapshot.library.likedSongIds=[restored.snapshot.songs[0].id];
    restored.snapshot.library.preferences.desktopLyrics.fontSize=42;
    const replacement=path.join(profile,'replacement.json');fs.writeFileSync(replacement,JSON.stringify(restored));
    await page.getByLabel('选择完整备份',{exact:true}).setInputFiles(replacement);
    await page.getByLabel('备份恢复预览',{exact:true}).waitFor();
    await page.evaluate(()=>{
      window.originalBackupPut=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='files')throw new DOMException('Injected quota failure','QuotaExceededError');return window.originalBackupPut.apply(this,args);};
    });
    await page.getByRole('button',{name:'确认替换并恢复',exact:true}).click();
    await page.getByText(/恢复失败，原音乐库保留/).waitFor();assert.deepEqual(await readState(),original);
    await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalBackupPut;});
    console.log('PASS failed transaction rolls back metadata and audio and permits retry');
    await page.screenshot({path:path.join(profile,'backup-preview.png')});
    await page.getByRole('button',{name:'确认替换并恢复',exact:true}).click();
    await page.waitForEvent('load');await page.waitForFunction(()=>document.body?.innerText.includes('BiliMusic'));await page.waitForTimeout(400);
    let result=await readState();assert.equal(result.snapshot.queue.length,0);assert.equal(result.snapshot.songs.length,1);
    assert.equal(result.snapshot.songs[0].title,'Restored backup');assert.equal(result.snapshot.songs[0].lyricsOffset,2);
    assert.equal(result.snapshot.library.preferences.desktopLyrics.fontSize,42);assert.equal(result.bytes,wav.length);
    await page.reload();await page.waitForFunction(()=>document.body?.innerText.includes('BiliMusic'));await page.waitForTimeout(400);
    result=await readState();assert.equal(result.snapshot.queue.length,0);assert.equal(result.snapshot.songs[0].title,'Restored backup');
    await page.addStyleTag({content:'* { transition: none !important; }'});
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');await page.waitForTimeout(100);
    await page.locator('button[title="设置"]').first().click();await page.getByRole('button',{name:'音乐库 · 1',exact:true}).click();
    await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').paused===false);
    assert.deepEqual(errors,[]);
    console.log('PASS atomic restore, empty queue, metadata and settings survive reload; restored audio plays');
    console.log('Backup QA:',profile);
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
