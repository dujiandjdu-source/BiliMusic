const test=require('node:test'),assert=require('node:assert/strict');
const {createRuntime,song}=require('./runtime.cjs');

test('lyric calibration moves lines and words together without changing raw metadata and uses matching desktop timing',()=>{
  const {calibrateLyrics,activeDesktopLyric}=createRuntime()('src/services/lyricCalibration.ts');
  const raw=[{time:-1,text:'credit',isMetadata:true},{time:1,endTime:3,text:'line',translation:'译文',words:[{text:'line',startTime:1,endTime:3}]}];
  const shifted=calibrateLyrics(raw,2);
  assert.equal(shifted[0],raw[0]); assert.equal(shifted[1].time,3); assert.equal(shifted[1].words[0].endTime,5);
  assert.equal(raw[1].time,1); assert.equal(raw[1].words[0].endTime,3);
  const track=song('a',{lyrics:raw,lyricsOffset:2});
  assert.equal(activeDesktopLyric(track,2).lyric,''); assert.equal(activeDesktopLyric(track,3).lyric,'line');
  assert.equal(activeDesktopLyric(track,5).lyric,''); assert.equal(calibrateLyrics(raw,-2)[1].time,-1);
});

test('calibration and desktop preferences survive serialization for both local and remote songs and reject malformed values',()=>{
  const load=createRuntime({'src/services/utils.ts':{}}),store=load('src/services/libraryStore.ts');
  const prefs=load('src/services/preferences.ts').defaultPreferences();prefs.desktopLyrics.fontSize=42;prefs.desktopLyrics.clickThrough=true;
  const library={...store.getDefaultMusicLibrary(),preferences:prefs};
  const tracks=[song('local',{source:'local',lyricsOffset:1.2,lyricsManual:true}),song('remote',{source:'remote',fileUrl:'https://audio.test/a',lyricsOffset:-2.3,lyricsSourceId:'123'})];
  const snap=store.parseLibrarySnapshot(JSON.parse(JSON.stringify(store.buildLibrarySnapshot(tracks,library))));
  assert.equal(store.fromStoredSong(snap.songs[0],'blob:restored').lyricsOffset,1.2);
  assert.equal(store.fromStoredSong(snap.songs[1]).lyricsSourceId,'123');
  assert.equal(snap.library.preferences.desktopLyrics.fontSize,42);assert.equal(snap.library.preferences.desktopLyrics.clickThrough,true);
  const malformed=store.parseLibrarySnapshot({queue:[{...snap.queue[1],lyricsOffset:Infinity,lyricsSourceId:{},lyricsManual:'yes'}],library:{preferences:{desktopLyrics:{fontSize:900,color:'bad',locked:'yes'},shortcuts:{toggle:{}}}}});
  assert.equal(malformed.songs[0].lyricsOffset,0);assert.equal(malformed.songs[0].lyricsManual,undefined);
  assert.equal(malformed.library.preferences.desktopLyrics.fontSize,72);assert.equal(malformed.library.preferences.desktopLyrics.color,'#ffffff');
});

test('sleep timer uses an absolute deadline, replaces previous schedules, cancels and stops once after suspension',()=>{
  const {SleepTimer}=createRuntime()('src/services/sleepTimer.ts');
  let now=0,stops=0,id=0;const tasks=new Map();
  const timer=new SleepTimer(()=>stops++,()=>{}, {now:()=>now,schedule:(cb,delay)=>{tasks.set(++id,{cb,delay});return id;},cancel:key=>tasks.delete(key)});
  timer.armMinutes(15);assert.equal(timer.state.expiresAt,900000);assert.equal(tasks.size,1);
  now=100;timer.armMinutes(30);assert.equal(timer.state.expiresAt,1800100);assert.equal(tasks.size,1);
  timer.cancel();assert.equal(tasks.size,0);assert.equal(stops,0);
  timer.armMinutes(60);now+=3600001;const callback=[...tasks.values()][0].cb;tasks.clear();callback();
  assert.equal(stops,1);assert.equal(timer.state.mode,'off');callback();assert.equal(stops,1);
});

test('after-song stop suppresses the next track, cancels on skipping and also handles expired deadlines at ended',()=>{
  const {SleepTimer}=createRuntime()('src/services/sleepTimer.ts');let stops=0,now=0;
  const timer=new SleepTimer(()=>stops++,()=>{}, {now:()=>now,schedule:()=>1,cancel:()=>{}});
  timer.armAfterSong('a');assert.equal(timer.consumeEnded('b'),false);assert.equal(timer.consumeEnded('a'),true);assert.equal(stops,1);
  timer.armAfterSong('a');timer.songChanged('b');assert.equal(timer.state.mode,'off');assert.equal(timer.consumeEnded('b'),false);
  timer.armMinutes(15);now=900000;assert.equal(timer.consumeEnded('b'),true);assert.equal(stops,2);
});

test('default timer clock invokes browser timers without binding them to a foreign object',()=>{
  const scheduled=[],canceled=[];
  const {SleepTimer}=createRuntime({}, {
    setTimeout:function(callback,delay){if(this?.schedule)throw Error('Illegal invocation');scheduled.push({callback,delay});return 123;},
    clearTimeout:function(handle){if(this?.cancel)throw Error('Illegal invocation');canceled.push(handle);},
  })('src/services/sleepTimer.ts');
  const timer=new SleepTimer(()=>{},()=>{});timer.armMinutes(15);assert.equal(scheduled.length,1);assert.equal(scheduled[0].delay,60000);
  timer.cancel();assert.deepEqual(canceled,[123]);
});

test('global shortcut changes roll back conflicts and invalid combinations, route each action and unregister on disposal',()=>{
  const createManager=require('../../electron/global-shortcuts.cjs'),registry=new Map(),events=[];
  const api={register:(key,cb)=>{if(key==='Occupied')return false;if(key==='Invalid')throw Error('bad accelerator');registry.set(key,cb);return true;},unregister:key=>registry.delete(key)};
  const manager=createManager(api,action=>events.push(action));
  const bindings={toggle:'Ctrl+Alt+Space',previous:'Ctrl+Alt+Left',next:'Ctrl+Alt+Right',favorite:'Ctrl+Alt+F'};
  assert.equal(manager.configure(bindings).success,true);registry.get(bindings.favorite)();assert.deepEqual(events,['favorite']);
  assert.equal(manager.configure({...bindings,next:'Occupied'}).success,false);assert.equal(registry.size,4);assert.ok(registry.has(bindings.next));
  assert.equal(manager.configure({...bindings,next:'Invalid'}).success,false);assert.equal(registry.size,4);
  assert.equal(manager.configure({...bindings,next:'CommandOrControl+Alt+Space'}).success,false);assert.equal(registry.size,4);
  assert.equal(manager.configure({...bindings,next:''}).success,true);assert.equal(registry.size,3);
  manager.dispose();assert.equal(registry.size,0);
});

test('native metadata requests normalize legacy artist and album fields, cap input and reject invalid song IDs',async()=>{
  const {searchSongs,getLyrics}=require('../../electron/netease-metadata.cjs')._test;
  const calls=[];const ses={fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({code:200,result:{songs:[{id:123,name:'song',artists:[{name:'artist'}],album:{name:'album'},duration:10000}]},lrc:{lyric:'[00:00]text'}})};}};
  const result=await searchSongs(ses,'query',900,-1);assert.equal(result.result.songs[0].ar[0].name,'artist');
  assert.equal(result.result.songs[0].dt,10000);assert.equal(new URL(calls[0].url).searchParams.get('limit'),'100');
  assert.equal(new URL(calls[0].url).searchParams.get('offset'),'0');assert.ok(calls[0].options.signal);
  assert.equal((await getLyrics(ses,'123')).lrc.lyric,'[00:00]text');
  await assert.rejects(getLyrics(ses,'invalid'),/ID 无效/);assert.equal(calls.length,2);
});
