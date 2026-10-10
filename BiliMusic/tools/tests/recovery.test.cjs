const test = require('node:test');
const assert = require('node:assert/strict');
const { File } = require('node:buffer');
const { createRuntime, createHooks, deferred, song } = require('./runtime.cjs');

test('drag captures synchronously, retains motion during IPC, and ignores late replies after release', async () => {
  const runner = createHooks(), requests = [], moves = [];
  const load = createRuntime({ react: runner.hooks }, { window: { electronAPI: { win: {
    getPosition() { const d = deferred(); requests.push(d); return d.promise; },
    moveTo: async (x, y) => { moves.push([x, y]); },
  } } } });
  const { useWindowDrag } = load('src/hooks/useWindowDrag.ts');
  runner.mount(useWindowDrag);
  let captured = false;
  const e = { button: 0, pointerId: 1, screenX: 100, screenY: 200,
    target: { closest: () => null }, currentTarget: { setPointerCapture() { captured = true; } } };
  runner.current.onPointerDown(e); assert.equal(captured, true); e.currentTarget = null;
  runner.current.onPointerMove({ pointerId: 1, screenX: 130, screenY: 240 });
  requests[0].resolve([400, 300]); await runner.settle();
  assert.deepEqual(moves.at(-1), [430, 340]);
  runner.current.onPointerUp();
  runner.current.onPointerDown({ ...e, currentTarget: { setPointerCapture() {} } });
  runner.current.onPointerUp(); const count = moves.length;
  requests[1].resolve([0, 0]); await runner.settle(); assert.equal(moves.length, count);
  runner.current.onPointerDown({ ...e, target: { closest: () => ({}) } });
  assert.equal(requests.length, 2);
});

function recoveryHarness(overrides = {}) {
  const runner = createHooks();
  const store = createRuntime({ 'src/services/utils.ts': {} })('src/services/libraryStore.ts');
  const load = createRuntime({ react: runner.hooks,
    'src/hooks/useI18n.tsx': { useI18n: () => ({ dict: { playlist: { unknownArtist: 'unknown' }, app: { importFail: 'failed' } } }) },
    'src/services/utils.ts': { parseAudioMetadata: async () => ({}) },
    'src/services/libraryStore.ts': { ...store, loadLibrarySnapshot: async () => null,
      saveLibrarySnapshot: async () => {}, saveLocalFiles: async () => {}, ...overrides },
  }, { console: { ...console, warn() {} } });
  const { usePlaylist } = load('src/hooks/usePlaylist.ts'); runner.mount(usePlaylist);
  return { runner, store };
}

test('startup restoration preserves newly imported songs and profile edits', async () => {
  const restore = deferred();
  const h = recoveryHarness({ loadLibrarySnapshot: () => restore.promise,
    hydrateLibrarySnapshot: async () => ({ queue: [song('old')], library: h.store.getDefaultMusicLibrary() }) });
  h.runner.current.addSongs([song('new')]);
  h.runner.current.updateProfile({ displayName: 'edited' }); h.runner.flush();
  restore.resolve({}); await h.runner.settle();
  assert.deepEqual(Array.from(h.runner.current.queue, s => s.id), ['new', 'old']);
  assert.equal(h.runner.current.library.profile.displayName, 'edited');
  h.runner.unmount();
});

test('failed local persistence rejects the import and never publishes an ephemeral song', async () => {
  const h = recoveryHarness({ saveLocalFiles: async () => { throw Error('QuotaExceededError'); } });
  await h.runner.settle();
  await assert.rejects(h.runner.current.addLocalFiles([new File(['audio'], 'artist - song.wav')]), /保存失败/);
  await h.runner.settle(); assert.equal(h.runner.current.queue.length, 0); h.runner.unmount();
});

test('restoration sanitizes malformed nested lyrics without losing valid songs', () => {
  const { store } = recoveryHarness();
  const parsed = store.parseLibrarySnapshot({ queue: [{ id: 'a', title: 'a', artist: 'a', source: 'remote',
    origin: 'https://audio.test/a', coverUrl: {}, colors: {}, originalTitle: {},
    lyrics: [null, { text: {}, time: 0 }, { text: 'valid', time: 1, translation: {}, words: [null, { text: 'word', startTime: 1, endTime: 2 }] }],
  }] });
  const restored = store.fromStoredSong(parsed.queue[0]);
  assert.equal(restored.lyrics.length, 1); assert.equal(restored.lyrics[0].text, 'valid');
  assert.equal(restored.lyrics[0].words.length, 1); assert.equal(restored.lyrics[0].translation, undefined);
  assert.equal(restored.coverUrl, undefined); assert.equal(restored.colors.length, 0);
});
