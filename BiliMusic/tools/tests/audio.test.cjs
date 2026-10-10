const test=require('node:test'),assert=require('node:assert/strict');
const {createRuntime}=require('./runtime.cjs');
const load=createRuntime();
const {normalizationGain,normalizeAudioPreferences}=load('src/services/audioSettings.ts');
test('audio settings bound every band, fade and playback value and migrate missing preferences',()=>{
  const settings=normalizeAudioPreferences({gains:[Infinity,100,-100,'3'],crossfadeSeconds:99,volume:-1,speed:99});
  assert.deepEqual(Array.from(settings.gains),[0,12,-12,0,0,0,0,0,0,0]);
  assert.equal(settings.crossfadeSeconds,8);assert.equal(settings.volume,0);assert.equal(settings.speed,3);
  const store=createRuntime({'src/services/utils.ts':{}})('src/services/libraryStore.ts');
  const library=store.normalizeMusicLibrary({preferences:{audio:{crossfadeSeconds:2,gains:[3],normalization:true,volume:0.4,speed:1.5,preservesPitch:false}}});
  const parsed=store.parseLibrarySnapshot(JSON.parse(JSON.stringify({songs:[],queue:[],library})));
  assert.equal(parsed.library.preferences.audio.gains[0],3);assert.equal(parsed.library.preferences.audio.volume,0.4);
  assert.equal(parsed.library.preferences.audio.speed,1.5);assert.equal(parsed.library.preferences.audio.preservesPitch,false);
  assert.equal(store.normalizeMusicLibrary().preferences.audio.crossfadeSeconds,0);
});
test('real-time leveling gates silence, protects peaks and limits gain for quiet and loud signals',()=>{
  assert.equal(normalizationGain(0,0),null);assert.equal(normalizationGain(0.001,0.002),null);
  assert.equal(normalizationGain(NaN,1),null);assert.equal(normalizationGain(0.01,0.02),4);
  assert.equal(normalizationGain(0.5,0.7),0.25);
  assert.ok(normalizationGain(0.01,1)<=0.95);
});
