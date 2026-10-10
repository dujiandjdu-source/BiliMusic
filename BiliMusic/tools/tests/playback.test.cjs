const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime, createHooks, deferred, song } = require("./runtime.cjs");

function playerHarness(initialQueue) {
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
    "src/services/lyricsService.ts": {},
    "src/services/libraryStore.ts": { loadPlaybackSnapshot: () => ({ songId: null, playMode: 0 }), savePlaybackSnapshot() {} },
  }, { console: { ...console, error() {} } });
  const { usePlayer } = load("src/hooks/usePlayer.ts"); const types = load("src/types.ts");
  const updateSongInQueue = () => {};
  const setQueue = (update) => {
    if (typeof update === "function") update(queue);
    queue = typeof update === "function" ? update(queue) : update;
  };
  runner.mount(() => {
    const player = usePlayer({ isReady: true, queue, updateSongInQueue, setQueue });
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

test("first import selects its actual song rather than a stale empty queue", async () => {
  const h = playerHarness([]);
  h.publishQueue([song("a")]);
  await h.act((player) => player.handlePlaylistAddition([song("a")], true));
  assert.equal(h.runner.current.currentSong.id, "a");
  assert.equal(h.runner.current.playState, h.types.PlayState.PLAYING);
  await h.act((player) => player.addSongAndPlay(song("a")));
  assert.equal(h.runner.current.currentSong.id, "a");
});
