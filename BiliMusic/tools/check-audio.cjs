// Actual Chromium DSP measurements and Electron crossfade UI checks. Uses a fresh user profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const ts=require('typescript');
const {_electron}=require(process.argv[2]||'playwright');
const root=path.resolve(__dirname,'..'),appDirectory=path.resolve(process.argv[3]||root);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'bilimusic-audio-check-'));
const bootstrap=path.join(profile,'bootstrap.cjs');
fs.writeFileSync(bootstrap,`
const electron=require('electron'),{app}=electron;app.setPath('userData',${JSON.stringify(profile)});app.setAppPath(${JSON.stringify(appDirectory)});
Object.defineProperty(app,'isPackaged',{get:()=>true});const RealWindow=electron.BrowserWindow;
const shadow=Object.create(electron);Object.defineProperty(shadow,'BrowserWindow',{value:new Proxy(RealWindow,{construct(T,a){return new T({...a[0],show:false});}})});
const Module=require('module'),original=Module._load;Module._load=function(n,...a){return n==='electron'?shadow:original.call(this,n,...a);};
const {autoUpdater}=require(${JSON.stringify(path.join(root,'node_modules/electron-updater'))});autoUpdater.checkForUpdates=async()=>{autoUpdater.emit('update-not-available');return null;};
const updateModule=require('module'),updateLoad=updateModule._load;updateModule._load=function(n,...a){return n==='electron-updater'?{autoUpdater}:updateLoad.call(this,n,...a);};
require(${JSON.stringify(path.join(appDirectory,'electron/main.cjs'))});
`);
const transpile=name=>ts.transpileModule(fs.readFileSync(path.join(root,'src/services',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
(async()=>{
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[bootstrap]});
 try{
  await app.firstWindow();let page;
  for(let i=0;i<100&&!page;i++){page=app.windows().find(p=>p.url().startsWith('file:'));if(!page)await new Promise(r=>setTimeout(r,100));}
  assert.ok(page);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>document.body?.innerText.includes('BiliMusic'));
  const measurements=await page.evaluate(async ({settingsCode,engineCode})=>{
    const instantiate=(code,require)=>{const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,require);return module.exports;};
    const settings=instantiate(settingsCode,()=>{}),{AudioGraph}=instantiate(engineCode,()=>settings);
    async function render(frequency,amplitude,options,level){
      const context=new OfflineAudioContext(1,48000*4,48000),graph=new AudioGraph(context);
      graph.configure({...settings.defaultAudioPreferences(),...options});
      if(level)graph.updateLevel(...level);
      const osc=context.createOscillator(),gain=context.createGain();osc.frequency.value=frequency;gain.gain.value=amplitude;
      osc.connect(gain);gain.connect(graph.input);osc.start();
      const buffer=await context.startRendering(),samples=buffer.getChannelData(0);let sum=0,peak=0;
      for(let i=48000*3;i<samples.length;i++){sum+=samples[i]*samples[i];peak=Math.max(peak,Math.abs(samples[i]));}
      return {rms:Math.sqrt(sum/48000),peak};
    }
    const flat=await render(1000,0.1,{}),cut=await render(1000,0.1,{equalizerEnabled:true,gains:settings.EQ_FREQUENCIES.map(f=>f===1000?-12:0)});
    const gains=settings.EQ_FREQUENCIES.map(f=>f===1000?12:0);
    const boost=await render(1000,0.1,{equalizerEnabled:true,gains}),offBand=await render(125,0.1,{equalizerEnabled:true,gains});
    const quiet=await render(1000,0.02,{normalization:true},[0.02/Math.sqrt(2),0.02]);
    const loud=await render(1000,0.5,{normalization:true},[0.5/Math.sqrt(2),0.5]);
    return {flat,cut,boost,offBand,quiet,loud};
  },{settingsCode:transpile('audioSettings'),engineCode:transpile('audioEngine')});
  console.log('DSP measurements:',measurements);
  assert.ok(Math.abs(measurements.flat.rms-0.1/Math.sqrt(2))<0.001,'disabled DSP preserves signal amplitude');
  assert.ok(measurements.cut.rms<measurements.flat.rms*0.3,'-12 dB attenuates selected frequency');
  assert.ok(measurements.boost.rms>measurements.offBand.rms*3,'boost changes spectral balance with headroom');
  assert.ok(measurements.quiet.rms>0.05&&measurements.quiet.rms<0.06,'quiet audio receives bounded boost');
  assert.ok(Math.abs(measurements.loud.rms-0.125)<0.003,'loud signal reaches RMS target');
  console.log('PASS actual OfflineAudioContext EQ, bypass and normalization measurements');
  await page.addInitScript(()=>{
    window.testAudioSources=[];window.testAudioConnections=[];
    const create=AudioContext.prototype.createMediaElementSource,connect=AudioNode.prototype.connect;
    AudioContext.prototype.createMediaElementSource=function(audio){const node=create.call(this,audio);window.testAudioSources.push({audio,node});return node;};
    AudioNode.prototype.connect=function(...args){window.testAudioConnections.push({from:this,to:args[0]});return connect.apply(this,args);};
  });
  await page.reload();await page.waitForFunction(()=>document.body?.innerText.includes('BiliMusic'));
  const files=[440,880].map((frequency,index)=>{
    const wav=Buffer.alloc(44+48000*2*12);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);
    wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    for(let i=0;i<(wav.length-44)/2;i++)wav.writeInt16LE(Math.round(0.1*32767*Math.sin(2*Math.PI*frequency*i/48000)),44+2*i);
    const filename=path.join(profile,`Test artist - Tone ${index+1}.wav`);fs.writeFileSync(filename,wav);return filename;
  });
  await page.locator('input[accept="audio/*,.lrc,.txt"]').setInputFiles(files);await page.waitForFunction(()=>document.querySelector('audio')?.paused===false);
  const liveSignal = await page.evaluate(async()=>{
    const output=window.testAudioConnections.find(edge=>edge.to===edge.from.context.destination).from;
    const analyser=output.context.createAnalyser();output.connect(analyser);
    await new Promise(resolve=>setTimeout(resolve,250));
    const samples=new Float32Array(2048);analyser.getFloatTimeDomainData(samples);output.disconnect(analyser);
    return {state:output.context.state,rms:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length)};
  });
  assert.equal(liveSignal.state,'running');assert.ok(liveSignal.rms>0.05,'integrated player emits nonzero audio through the shared graph');
  const openSettings=async()=>{
    await page.addStyleTag({content:'* { transition: none !important; }'});
    await page.locator('div.z-\\[1000\\]').dispatchEvent('mouseover');await page.waitForTimeout(100);
    await page.locator('button[title="设置"]').first().click();await page.getByRole('button',{name:'播放设置',exact:true}).click();
  };
  await openSettings();await page.getByLabel('切歌淡入淡出秒数',{exact:true}).fill('2');
  await page.getByLabel('启用均衡器',{exact:true}).check();
  await page.getByLabel('均衡器 1000 Hz',{exact:true}).fill('6');
  await page.getByLabel('实时音量均衡',{exact:true}).check();
  await page.screenshot({path:path.join(profile,'audio-settings.png')});
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.evaluate(()=>{document.querySelector('audio').currentTime=2;});
  await page.getByRole('button',{name:'下一首',exact:true}).first().click();
  await page.waitForFunction(()=>window.testAudioSources.some(s=>s.audio!==document.querySelector('audio')&&!s.audio.paused));
  await page.waitForFunction(()=>document.querySelector('audio').paused===false);
  await page.waitForTimeout(250);
  const envelope=await page.evaluate(()=>{
    const primary=document.querySelector('audio'),sources=window.testAudioSources;
    const gainFor=source=>window.testAudioConnections.find(edge=>edge.from===source.node).to.gain.value;
    return {incoming:gainFor(sources.find(source=>source.audio===primary)),outgoing:gainFor(sources.find(source=>source.audio!==primary&&!source.audio.paused))};
  });
  assert.ok(envelope.incoming>0&&envelope.incoming<1&&envelope.outgoing>0&&envelope.outgoing<1,'both tracks use changing gains');
  assert.ok(Math.abs(envelope.incoming+envelope.outgoing-1)<0.1,'complementary fade gains');
  assert.equal(await page.evaluate(()=>window.testAudioSources.filter(s=>s.audio===document.querySelector('audio')).length),1,'primary media source is created once');
  assert.equal(await page.evaluate(()=>window.testAudioConnections.filter(e=>e.to===e.from.context.destination).length),1,'one audible destination path');
  await page.waitForFunction(()=>window.testAudioSources.filter(s=>s.audio!==document.querySelector('audio')).every(s=>s.audio.paused),{},{timeout:5000});
  console.log('PASS actual manual crossfade overlaps two sources, cleans tail and has one destination');
  await page.getByRole('button',{name:'下一首',exact:true}).first().click();
  await page.waitForFunction(()=>window.testAudioSources.some(s=>s.audio!==document.querySelector('audio')&&!s.audio.paused));
  await page.getByRole('button',{name:'播放 / 暂停',exact:true}).first().click();
  await page.waitForFunction(()=>window.testAudioSources.every(s=>s.audio.paused));
  console.log('PASS pause cancels all outgoing audio');
  await page.reload();await page.waitForFunction(()=>document.body?.innerText.includes('Tone'));
  await openSettings();assert.equal(await page.getByLabel('切歌淡入淡出秒数',{exact:true}).inputValue(),'2');
  assert.equal(await page.getByLabel('均衡器 1000 Hz',{exact:true}).inputValue(),'6');
  assert.equal(await page.getByLabel('实时音量均衡',{exact:true}).isChecked(),true);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.getByRole('button',{name:'播放 / 暂停',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('audio').paused===false);
  const firstSrc=await page.evaluate(()=>document.querySelector('audio').src);
  await page.evaluate(()=>{const audio=document.querySelector('audio');audio.currentTime=audio.duration-1.5;});
  await page.waitForFunction(src=>document.querySelector('audio').src!==src,firstSrc);
  console.log('PASS persisted audio preferences and automatic near-end transition');
  await page.waitForTimeout(2200);
  await openSettings();await page.getByRole('button',{name:'当前歌曲播完停止',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const sleepingSrc=await page.evaluate(()=>{const audio=document.querySelector('audio');audio.currentTime=audio.duration-1.5;return audio.src;});
  await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>document.querySelector('audio').src),sleepingSrc,'sleep timer suppresses early crossfade');
  await page.waitForFunction(()=>document.querySelector('audio').ended&&document.querySelector('audio').paused);
  assert.equal(await page.evaluate(()=>window.testAudioSources.every(source=>source.audio.paused)),true);
  console.log('PASS after-song sleep preserves the end of the song and stops every audio source');
  assert.deepEqual(errors,[]);console.log('Audio QA:',profile);
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
