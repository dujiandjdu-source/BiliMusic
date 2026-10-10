const test = require("node:test");
const assert = require("node:assert/strict");
const { File } = require("node:buffer");
const { createRuntime, createHooks, song } = require("./runtime.cjs");

function playlistHarness() {
  const runner = createHooks(); const deleted = [], saved = [];
  const pureStore = createRuntime({ "src/services/utils.ts": {} })("src/services/libraryStore.ts");
  const video = { bvid: "BV1234567890", title: "作品合集", author: "UP", pages: [
    { cid: 7, part: "01. 第一首【高音质】" }, { cid: 8, part: "第二首" },
  ] };
  const load = createRuntime({
    react: runner.hooks,
    "src/hooks/useI18n.tsx": { useI18n: () => ({ dict: { playlist: { unknownArtist: "未知歌手" }, app: { importFail: "导入失败" } } }) },
    "src/services/utils.ts": { extractColors: async () => [], parseAudioMetadata: async () => ({}), parseNeteaseLink: () => null },
    "src/services/libraryStore.ts": {
      ...pureStore, loadLibrarySnapshot: async () => null, saveLibrarySnapshot: async () => {},
      saveLocalFiles: async (files) => { saved.push(...files); }, deleteLocalFiles: async (ids) => { deleted.push(...ids); },
    },
    "src/services/bilibiliService.ts": { getVideoInfo: async () => video, getVideoAudioUrl: async (_bvid, cid) => ({ cid, url: `bili-audio://test?cid=${cid}` }) },
  });
  const { usePlaylist } = load("src/hooks/usePlaylist.ts");
  runner.mount(() => usePlaylist());
  return { runner, deleted, saved };
}

test("concurrent local imports report only accepted songs and release rejected files", async () => {
  const h = playlistHarness(); await h.runner.settle();
  const files = [new File(["audio"], "歌手 - Re-Write - Live.wav", { type: "audio/wav" }),
    new File(["[00:00.00]歌词"], "歌手 - Re-Write - Live.lrc", { type: "text/plain" })];
  const first = h.runner.current.addLocalFiles(files); const second = h.runner.current.addLocalFiles(files);
  const [a, b] = await Promise.all([first, second]); await h.runner.settle();
  assert.equal(a.length + b.length, 1); assert.equal(h.runner.current.queue.length, 1);
  const current = h.runner.current.queue[0]; assert.equal(current.title, "Re-Write - Live");
  assert.equal(current.artist, "歌手"); assert.equal(current.lyrics[0].text, "歌词");
  assert.equal(h.deleted.length, 1); assert.notEqual(h.deleted[0], current.id);
  h.runner.current.removeSongs([current.id]); await h.runner.settle();
  assert.equal(h.runner.current.queue.length, 0); assert.equal(h.deleted.filter((id) => id === current.id).length, 1);
});

test("concurrent Bilibili imports keep stable part titles and report duplicates honestly", async () => {
  const h = playlistHarness(); await h.runner.settle();
  const [a, b] = await Promise.all([
    h.runner.current.importFromUrl("BV1234567890"), h.runner.current.importFromUrl("BV1234567890"),
  ]); await h.runner.settle();
  assert.equal(a.songs.length + b.songs.length, 2); assert.notEqual(a.success, b.success);
  assert.deepEqual(Array.from(h.runner.current.queue, (row) => row.title), ["第一首", "第二首"]);
  assert.ok(h.runner.current.queue.every((row) => row.biliVideoTitle === "作品合集"));
  assert.equal(h.runner.current.queue[0].biliCid, 7);
});

test("invalid reorder operations preserve every existing song", async () => {
  const h = playlistHarness(); await h.runner.settle();
  h.runner.current.addSongs([song("a"), song("b")]); h.runner.current.reorder(["a", "a"]); h.runner.flush();
  assert.deepEqual(Array.from(h.runner.current.queue, (row) => row.id), ["a", "b"]);
  h.runner.current.reorder(["b", "a"]); h.runner.flush();
  assert.deepEqual(Array.from(h.runner.current.queue, (row) => row.id), ["b", "a"]);
});
