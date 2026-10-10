const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, song, deferred } = require('./runtime.cjs');

function harness(overrides = {}) {
  const load = createRuntime({ 'src/services/utils.ts': {}, ...overrides }, { atob });
  return { backup: load('src/services/libraryBackup.ts'), store: load('src/services/libraryStore.ts') };
}
function fixture(store, queue = []) {
  const songs = [song('local', {source:'local',lyricsOffset:2,lyricsManual:true}),
    song('online', {source:'remote',fileUrl:'https://example.org/audio',origin:'https://example.org/audio'})];
  const library = {...store.getDefaultMusicLibrary(), likedSongIds:['local'],favoriteSongIds:['online'],
    playlists:[{id:'p',name:'Saved',songIds:['local','online'],createdAt:1,updatedAt:2}]};
  return {app:'BiliMusic',kind:'full-library-backup',version:1,exportedAt:new Date().toISOString(),
    snapshot:store.buildLibrarySnapshot(queue,library,songs),files:[{id:'local',mime:'audio/wav',base64:Buffer.from('audio bytes').toString('base64')}]};
}

test('full backup preview preserves an empty queue, song lyrics/calibration, settings and exact local audio without writes', async () => {
  const h=harness(), raw=fixture(h.store), before=JSON.stringify(raw);
  raw.snapshot.library.preferences.desktopLyrics.fontSize=42;
  const preview=h.backup.previewLibraryBackup(raw);
  assert.equal(preview.snapshot.queue.length,0);
  assert.equal(preview.snapshot.songs.length,2);
  assert.equal(preview.snapshot.songs[0].lyricsOffset,2);
  assert.equal(preview.snapshot.songs[0].lyricsManual,true);
  assert.equal(preview.snapshot.songs[0].lyrics[0].text,'lyrics');
  assert.equal(preview.snapshot.library.preferences.desktopLyrics.fontSize,42);
  assert.equal(await preview.files[0].file.text(),'audio bytes');
  assert.equal(preview.audioBytes,11);
  assert.equal(preview.snapshot.library.playlists[0].songIds[0],'local');
  assert.ok(before.includes('full-library-backup'));
});

test('backup rejects unsupported formats, duplicate IDs, missing audio, corrupt base64 and dangling queue or collection references', () => {
  const h=harness();
  const checks=[raw=>raw.version=999,raw=>raw.snapshot.songs.push(raw.snapshot.songs[0]),
    raw=>raw.files=[],raw=>raw.files[0].base64='not base64!',raw=>raw.files.push(raw.files[0]),
    raw=>raw.snapshot.queue.push({...raw.snapshot.songs[1],id:'missing'}),
    raw=>raw.snapshot.library.likedSongIds.push('missing'),raw=>raw.snapshot.songs[1].origin=''];
  for(const mutate of checks){const raw=fixture(h.store);mutate(raw);assert.throws(()=>h.backup.previewLibraryBackup(raw),/备份格式/);}
  assert.throws(()=>h.backup.previewLibraryBackup(null),/备份格式/);
});

test('large audio backup decodes in chunks without regex stack overflow and preserves all bytes', async () => {
  const h=harness(),raw=fixture(h.store),bytes=Buffer.alloc(2*1024*1024+13);
  for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  raw.files[0].base64=bytes.toString('base64');
  const preview=h.backup.previewLibraryBackup(raw);
  assert.deepEqual(Buffer.from(await preview.files[0].file.arrayBuffer()),bytes);
});

test('restore refuses unavailable storage and releases its write guard after failure', async () => {
  const h=harness(), preview=h.backup.previewLibraryBackup(fixture(h.store));
  await assert.rejects(h.backup.restorePreviewedBackup(preview),/存储不可用/);
  await assert.rejects(h.backup.restorePreviewedBackup(preview),/存储不可用/);
  // The second call proves that failure did not leave the restore guard latched.
  await assert.rejects(h.store.saveLocalFiles([{id:'test',file:new Blob(['test'])}]),/存储不可用/);
});
