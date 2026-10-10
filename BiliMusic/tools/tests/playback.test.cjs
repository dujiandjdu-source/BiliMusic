const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime, createHooks, deferred, song } = require("./runtime.cjs");

function playerHarness(initialQueue, onSongPlayed, lyricsService = {}) {
  const runner = createHooks(); let queue = initialQueue;
  const pending = [];
  const audio = {
    src: "", paused: true, currentTime: 0, duration: 60, readyState: 4, deferPlay: false,
    play() { this.paused = false; if (!this.deferPlay) return Promise.resolve(); const task = deferred(); pending.push(task); return task.promise; },
    pause() { this.paused = true; }, load() {}, addEventListener() {}, removeEventListener() {},
  };
  const load = createRuntime({
    react: runner.hooks,
    "src/services/utils.ts": { shuffleArray: (values) => [...values], extractColors: async () => [] },
    "src/services/lyricsService.ts": lyricsService,
    "src/services/libraryStore.ts": { loadPlaybackSnapshot: () => ({ songId: null, playMode: 0 }), savePlaybackSnapshot() {} },
  }, { console: { ...console, error() {} } });
  const { usePlayer } = load("src/hooks/usePlayer.ts"); const types = load("src/types.ts");
  const updateSongInQueue = (id, updates) => { queue = queue.map(row => row.id === id ? {...row,...updates} : row); };
  const setQueue = (update) => {
    if (typeof update === "function") update(queue);
    queue = typeof update === "function" ? update(queue) : update;
  };
  runner.mount(() => {
    const player = usePlayer({ isReady: true, queue, updateSongInQueue, setQueue, onSongPlayed });
    player.audioRef.current = audio;
    const source = player.currentSong?.fileUrl || "";
    if (source !== audio.src) { audio.src = source; audio.paused = true; }
    return player;
  });
  return { runner, audio, pending, types, get queue() { return queue; }, publishQueue(next) { queue = next; },
    async act(action) { action(runner.current); runner.flush(); await runner.settle(); } };
}

test("same-song replay and single-queue next/previous start the actual audio", async () => {
  for (const count of [1, 2]) {
    const h = playerHarness(Array.from({ length: count }, (_, index) => song(String(index))));
    await h.act((player) => player.playIndex(0)); assert.equal(h.audio.paused, false);
    h.audio.currentTime = 25;
    await h.act((player) => player.playIndex(0)); assert.equal(h.audio.paused, false); assert.equal(h.audio.currentTime, 0);
    await h.act((player) => player.playNext()); assert.equal(h.audio.paused, false);
    assert.equal(h.runner.current.currentSong.id, count === 1 ? "0" : "1");
    await h.act((player) => player.playPrev()); assert.equal(h.audio.paused, false); assert.equal(h.runner.current.currentSong.id, "0");
  }
});

test("shuffle previous works both before and after visiting another track", async () => {
  const h = playerHarness([song("a"), song("b")]);
  await h.act((player) => player.playIndex(0));
  await h.act((player) => player.toggleMode()); await h.act((player) => player.toggleMode());
  await h.act((player) => player.playPrev()); assert.equal(h.audio.paused, false); assert.equal(h.runner.current.currentSong.id, "a");
  await h.act((player) => player.playNext()); assert.equal(h.runner.current.currentSong.id, "b");
  await h.act((player) => player.playPrev()); assert.equal(h.audio.paused, false); assert.equal(h.runner.current.currentSong.id, "a");
});

test("a pending play completion cannot undo pause or a newer track selection", async () => {
  const h = playerHarness([song("a"), song("b")]); h.audio.deferPlay = true;
  h.runner.current.play(); assert.equal(h.pending.length, 1);
  h.runner.current.pause(); h.runner.flush(); h.pending[0].resolve(); await h.runner.settle();
  assert.equal(h.runner.current.playState, h.types.PlayState.PAUSED); assert.equal(h.audio.paused, true);
  h.runner.current.play(); const old = h.pending.at(-1);
  h.runner.current.playIndex(1); h.runner.flush();
  const latest = h.pending.at(-1); assert.notEqual(latest, old);
  latest.resolve(); await h.runner.settle(); assert.equal(h.runner.current.playState, h.types.PlayState.PLAYING);
  old.reject(new Error("old source failed")); await h.runner.settle();
  assert.equal(h.runner.current.currentSong.id, "b"); assert.equal(h.runner.current.playState, h.types.PlayState.PLAYING);
});

test("add-and-play remains unique when React replays the queue updater", async () => {
  const h = playerHarness([song("a")]);
  await h.act((player) => player.addSongAndPlay(song("b")));
  assert.equal(h.queue.length, 2); assert.equal(h.runner.current.currentSong.id, "b");
  await h.act((player) => player.addSongAndPlay(song("b")));
  assert.equal(h.queue.length, 2); assert.equal(h.runner.current.currentSong.id, "b");
});

test('history counts actual starts once per visit, including replay and loop, but excludes resume and failed play', async () => {
  const played = [];
  const h = playerHarness([song('a'), song('b')], id => played.push(id));
  await h.act(p => p.playIndex(0));
  h.runner.current.handleAudioPlaying(); h.runner.current.handleAudioPlaying();
  assert.deepEqual(played, ['a']);
  await h.act(p => p.pause()); await h.act(p => p.play()); h.runner.current.handleAudioPlaying();
  assert.deepEqual(played, ['a']);
  await h.act(p => p.playIndex(0)); h.runner.current.handleAudioPlaying();
  assert.deepEqual(played, ['a', 'a']);
  await h.act(p => p.toggleMode());
  await h.act(p => p.handleAudioEnded()); h.runner.current.handleAudioPlaying();
  assert.deepEqual(played, ['a', 'a', 'a']);
  h.audio.deferPlay = true; h.runner.current.playIndex(1); h.runner.flush();
  h.pending.at(-1).reject(Error('unavailable')); await h.runner.settle();
  assert.deepEqual(played, ['a', 'a', 'a']);
});

test('play a library playlist replaces queue in playlist order and replaying the same list restarts real audio', async () => {
  const h = playerHarness([song('a'),song('other')]);
  await h.act(p=>p.playIndex(0));
  await h.act(p=>p.playSongs([song('b'),song('a'),song('b')]));
  assert.deepEqual(h.queue.map(s=>s.id),['b','a']); assert.equal(h.runner.current.currentSong.id,'b');
  assert.equal(h.audio.paused,false); h.audio.currentTime = 20;
  await h.act(p=>p.playSongs([song('b'),song('a')]));
  assert.equal(h.audio.paused,false); assert.equal(h.audio.currentTime,0);
});

test('manual lyric import wins over pending automatic matching and stays with its original song', async () => {
  const auto = deferred();
  const h = playerHarness([song('a',{lyrics:[],needsLyricsMatch:true}),song('b')],undefined,
    {searchAndMatchLyrics:()=>auto.promise});
  await h.runner.settle();
  assert.equal(await h.runner.current.loadLyricsFile({text:async()=>'[00:01.00]manual'}),true);
  await h.runner.settle();
  auto.resolve({lrc:'[00:01.00]automatic',metadata:[]}); await h.runner.settle();
  assert.equal(h.queue[0].lyrics[0].text,'manual'); assert.equal(h.queue[0].lyricsManual,true);
  const file=deferred(); const pending=h.runner.current.loadLyricsFile({text:()=>file.promise});
  await h.act(p=>p.playIndex(1)); file.resolve('[00:02.00]late');
  assert.equal(await pending,false); assert.equal(h.queue[0].lyrics[0].text,'manual');
  assert.equal(h.queue[1].lyrics[0].text,'lyrics'); h.runner.unmount();
});

test('explicit lyric selection persists source ID and ignores superseded or empty matches', async () => {
  const requests = [];
  const h = playerHarness([song('a')],undefined,{fetchLyricsById:()=>{const d=deferred();requests.push(d);return d.promise;}});
  await h.runner.settle();
  const old=h.runner.current.selectLyricsMatch('1'), fresh=h.runner.current.selectLyricsMatch('2');
  requests[1].resolve({lrc:'[00:03.00]selected',metadata:[]}); assert.equal(await fresh,true); await h.runner.settle();
  requests[0].resolve({lrc:'[00:01.00]stale',metadata:[]}); assert.equal(await old,false);
  assert.equal(h.queue[0].lyricsSourceId,'2'); assert.equal(h.queue[0].lyrics[0].text,'selected');
  const empty=h.runner.current.selectLyricsMatch('3'); requests[2].resolve({lrc:'',metadata:[]});
  await assert.rejects(empty,/没有可用歌词/); assert.equal(h.queue[0].lyricsSourceId,'2'); h.runner.unmount();
});

test('sleep stop at ended suppresses loop or queue advancement and counts a later restart as a new visit',async()=>{
  const played=[];const h=playerHarness([song('a'),song('b')],id=>played.push(id));
  await h.act(p=>p.playIndex(0));h.runner.current.handleAudioPlaying();
  await h.act(p=>p.toggleMode());await h.act(p=>p.handleAudioEnded(true));
  assert.equal(h.audio.paused,true);assert.equal(h.runner.current.currentSong.id,'a');
  await h.act(p=>p.play());h.runner.current.handleAudioPlaying();assert.deepEqual(played,['a','a']);h.runner.unmount();
});

test('manual next in a single-song queue creates a new playback visit',async()=>{
  const played=[];const h=playerHarness([song('a')],id=>played.push(id));
  await h.act(p=>p.playIndex(0));h.runner.current.handleAudioPlaying();
  await h.act(p=>p.playNext());h.runner.current.handleAudioPlaying();
  assert.deepEqual(played,['a','a']);assert.equal(h.audio.paused,false);h.runner.unmount();
});

test("first import selects its actual song rather than a stale empty queue", async () => {
  const h = playerHarness([]);
  h.publishQueue([song("a")]);
  await h.act((player) => player.handlePlaylistAddition([song("a")], true));
  assert.equal(h.runner.current.currentSong.id, "a");
  assert.equal(h.runner.current.playState, h.types.PlayState.PLAYING);
  await h.act((player) => player.addSongAndPlay(song("a")));
  assert.equal(h.runner.current.currentSong.id, "a");
});
