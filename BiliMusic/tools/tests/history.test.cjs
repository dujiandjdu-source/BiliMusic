const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./runtime.cjs');
const history = createRuntime()('src/services/playHistory.ts');

test('history persists total counts, last played time and rolling 30-day frequent ordering', () => {
  const day = 86400000, now = 100 * day;
  let lib = { profile: {}, likedSongIds: [], favoriteSongIds: [], playlists: [] };
  lib = history.recordPlay(lib, 'old', now-31*day);
  lib = history.recordPlay(lib, 'a', now-2*day);
  lib = history.recordPlay(lib, 'b', now-day);
  lib = history.recordPlay(lib, 'a', now);
  assert.equal(lib.playHistory[0].songId,'a'); assert.equal(lib.playHistory[0].playCount,2);
  assert.equal(lib.playHistory[0].lastPlayedAt,now);
  assert.deepEqual(Array.from(history.recentlyFrequentIds(lib,now)),['a','b']);
  assert.ok(lib.playHistory.some(row=>row.songId==='old'),'lifetime statistics survive recent window expiry');
});

test('history sanitation excludes corrupt counts, timestamps, duplicate rows and future events', () => {
  const rows = history.normalizeHistory([null,{}, {songId:'a',playCount:0,lastPlayedAt:1},
    {songId:'a',playCount:2,lastPlayedAt:2},{songId:'a',playCount:3,lastPlayedAt:3},
    {songId:'b',playCount:Infinity,lastPlayedAt:1}]);
  assert.equal(rows.length,1); assert.equal(rows[0].playCount,3);
  const events = history.normalizePlayEvents([null,{songId:'a',playedAt:500},{songId:'future',playedAt:1001}],1000);
  assert.equal(events.length,1); assert.equal(events[0].songId,'a');
});
