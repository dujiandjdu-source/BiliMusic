const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime, createHooks, deferred, song } = require("./runtime.cjs");

test("compact titles keep real subtitles and distinguish song versions", () => {
  const names = createRuntime()("src/services/songMetadata.ts");
  assert.equal(names.cleanSongTitle("【高音质】 01. 晴天 【无损音质】"), "晴天");
  assert.equal(names.cleanSongTitle("Gate of Steiner (Live)"), "Gate of Steiner (Live)");
  assert.equal(names.cleanSongTitle("Re-Write - Acoustic"), "Re-Write - Acoustic");
  assert.equal(names.cleanSongTitle("【无损】"), "【无损】");
  assert.equal(names.cleanSongTitle(" "), "未知曲目");
  assert.equal(names.parseLocalFilename("歌手 - Re-Write - Live.flac").title, "Re-Write - Live");
  assert.equal(names.parseLocalFilename("Re-Write.flac").title, "Re-Write");
});

test("shared factories preserve source names, part identity, optional covers and quality", () => {
  const load = createRuntime({ "src/services/utils.ts": {} }, { window: { electronAPI: { netease: {} } } });
  const factory = load("src/services/songFactory.ts");
  const pages = [{ cid: 7, part: "01. 曲名【高音质】" }, { cid: 8, part: "曲名 (Live)" }];
  const video = { bvid: "BVtest", title: "作品原声合集", author: "UP", pages };
  const track = factory.createBilibiliSong(video, { url: "bili-audio://test", cid: 7 }, pages[0]);
  assert.equal(track.title, "曲名"); assert.equal(track.biliVideoTitle, "作品原声合集");
  assert.equal(track.originalTitle, pages[0].part); assert.equal(track.needsLyricsMatch, true);
  const cloud = factory.createNeteaseSong({ id: "123", neteaseId: "123", title: "曲名", artist: "歌手", isNetease: true }, "lossless");
  assert.equal(cloud.coverUrl, undefined);
  assert.equal(new URL(cloud.fileUrl).searchParams.get("quality"), "lossless");
  const store = load("src/services/libraryStore.ts");
  const restored = store.fromStoredSong(store.toStoredSong(track));
  assert.equal(restored.title, track.title); assert.equal(restored.biliVideoTitle, video.title);
  assert.equal(store.fromStoredSong(store.toStoredSong(cloud)).audioQuality, "lossless");
  assert.equal(new URL(store.fromStoredSong(store.toStoredSong(cloud)).fileUrl).searchParams.get("quality"), "lossless");
});

test("Bilibili collections display album names above and compact track names below", () => {
  const load = createRuntime({ "src/services/utils.ts": {} });
  const names = load("src/services/songMetadata.ts");
  const factory = load("src/services/songFactory.ts");
  const store = load("src/services/libraryStore.ts");
  const prefix = "[异度神剑2/异度之刃2 豪华CD OST]";
  const title = prefix + " - 02-碧空中的乐园";
  assert.equal(names.getBilibiliCollectionTitle(title), prefix);
  const pages = [{ cid: 1, part: prefix + " - 01-Xenoblade II - Live" }, { cid: 2, part: title }];
  const song = factory.createBilibiliSong({ bvid: "BVtest", title, pages }, { url: "bili-audio://test", cid: 1 }, pages[0]);
  assert.equal(song.title, "Xenoblade II - Live");
  assert.equal(song.originalTitle, pages[0].part); assert.equal(song.biliVideoTitle, title);
  const old = { ...store.toStoredSong(song), title: pages[0].part };
  assert.equal(store.fromStoredSong(old).title, "Xenoblade II - Live");
  assert.equal(names.getBilibiliTrackTitle("03-阿瓦利缇亚商会", title), "阿瓦利缇亚商会");
  assert.equal(names.getBilibiliTrackTitle("Re-Write - Live", title), "Re-Write - Live");
  assert.equal(names.getBilibiliCollectionTitle("专辑 - Live"), "专辑 - Live");
  assert.equal(names.getBilibiliTrackTitle(prefix, title), prefix);
});

test("queue identity deduplicates repeated imports but keeps different parts and versions", () => {
  const { uniqueSongsAgainst } = createRuntime()("src/services/songIdentity.ts");
  const part = song("part", { isBilibili: true, bvid: "BVtest", biliCid: 7 });
  const next = uniqueSongsAgainst([part], [
    { ...part, id: "alias" }, { ...part, id: "other", biliCid: 8 },
    song("live", { title: "song (Live)" }), song("studio", { title: "song" }),
  ]);
  assert.deepEqual(Array.from(next, (item) => item.id), ["other", "live", "studio"]);
});

test("queue mutations use the latest snapshot before a render and run updaters once", () => {
  const runner = createHooks();
  const load = createRuntime({ react: runner.hooks });
  const { useQueueState } = load("src/hooks/useQueueState.ts");
  runner.mount(() => useQueueState());
  const queue = runner.current;
  let calls = 0;
  queue.setQueue((old) => { calls++; return [...old, song("a")]; });
  queue.setQueue((old) => { calls++; return [...old, song("b")]; });
  assert.equal(calls, 2);
  assert.deepEqual(Array.from(queue.queueRef.current, (item) => item.id), ["a", "b"]);
  runner.flush(); assert.equal(runner.current.queue.length, 2);
});

test("stale searches and duplicate pagination cannot replace or duplicate current results", async () => {
  const runner = createHooks(); const requests = [];
  const fetchPage = (query, offset) => { const task = deferred(); requests.push({ query, offset, task }); return task.promise; };
  const keyOf = (row) => row.id;
  const { usePaginatedSearch } = createRuntime({ react: runner.hooks })("src/hooks/usePaginatedSearch.ts");
  runner.mount(() => usePaginatedSearch({ limit: 2, fetchPage, keyOf }));
  const old = runner.current.performSearch("old"); const current = runner.current.performSearch("current");
  requests[1].task.resolve([{ id: "a" }, { id: "b" }]); await current; runner.flush();
  requests[0].task.resolve([{ id: "old" }]); await old; runner.flush();
  assert.deepEqual(Array.from(runner.current.results, (row) => row.id), ["a", "b"]);
  const page = runner.current.loadMore("current", 100, 2);
  await runner.current.loadMore("current", 100, 2); assert.equal(requests.length, 3);
  assert.equal(requests[2].offset, 2);
  requests[2].task.resolve([{ id: "b" }, { id: "c" }]); await page; runner.flush();
  assert.deepEqual(Array.from(runner.current.results, (row) => row.id), ["a", "b", "c"]);
  const stalePage = runner.current.loadMore("current", 4, 2);
  const fresh = runner.current.performSearch("fresh");
  requests[3].task.reject(new Error("old request failed")); await stalePage; runner.flush();
  assert.equal(runner.current.isLoading, true); assert.equal(runner.current.error, "");
  requests[4].task.resolve([]); await fresh; runner.flush(); assert.equal(runner.current.hasMore, false);
  const pending = runner.current.performSearch("closed"); runner.unmount();
  requests[5].task.resolve([{ id: "closed" }]); await pending;
});

test("malformed storage and library imports cannot introduce invalid rows or React labels", () => {
  const load = createRuntime({ "src/services/utils.ts": {} });
  const store = load("src/services/libraryStore.ts");
  const valid = { id: "a", title: "曲名", artist: "歌手", source: "remote", origin: "https://audio.test/a" };
  const parsed = store.parseLibrarySnapshot({ queue: [null, {}, valid, valid, { ...valid, id: "bad", isBilibili: true }] });
  assert.equal(parsed.queue.length, 1);
  const lib = store.normalizeMusicLibrary({ profile: { displayName: { bad: true } }, likedSongIds: "bad", playlists: [null, { id: "p", name: {}, songIds: [42, "a"] }] });
  assert.equal(typeof lib.profile.displayName, "string");
  assert.equal(lib.likedSongIds.length, 0);
  assert.deepEqual(Array.from(lib.playlists[0].songIds), ["a"]);
});
