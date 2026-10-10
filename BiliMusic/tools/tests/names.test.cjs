const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, song, createHooks } = require('./runtime.cjs');

test('collection detection handles common separators, brackets, disc markers and unnumbered sibling parts', () => {
  const names = createRuntime()('src/services/songMetadata.ts');
  const cases = [
    ['游戏原声 - 01-Opening', ['游戏原声 - 01-Opening','游戏原声 - 02-Ending'], '游戏原声', ['Opening','Ending']],
    ['Album｜P01：Opening', ['Album｜P01：Opening','Album｜P02：Ending'], 'Album', ['Opening','Ending']],
    ['Album: Track 01 - Opening', ['Album: Track 01 - Opening','Album: Track 02 - Ending'], 'Album', ['Opening','Ending']],
    ['Album_01_Opening', ['Album_01_Opening','Album_02_Ending'], 'Album', ['Opening','Ending']],
    ['【作品音乐合集】 01 Opening', ['【作品音乐合集】 01 Opening','【作品音乐合集】 02 Ending'], '【作品音乐合集】', ['Opening','Ending']],
    ['Album - Disc 2 - Track 03 - Opening', ['Album - Disc 2 - Track 03 - Opening','Album - Disc 2 - Track 04 - Ending'], 'Album', ['Opening','Ending']],
    ['Album - Opening', ['Album - Opening','Album - Ending'], 'Album', ['Opening','Ending']],
    ['Album - Opening', ['Opening','Ending'], 'Album', ['Opening','Ending']],
    ['Album', ['Album - Opening','Album - Ending'], 'Album', ['Opening','Ending']],
    ['Album 01 Opening', ['Album 01 Opening','Album 02 Ending'], 'Album', ['Opening','Ending']],
    ['作品合集', ['第1首：Opening','第2首：Ending'], '作品合集', ['Opening','Ending']],
    ['作品合集', ['[01] Opening','[02] Ending'], '作品合集', ['Opening','Ending']],
    ['Re-Write OST — 01. Theme - Live', ['Re-Write OST — 01. Theme - Live','Re-Write OST — 02. Theme - Remix'], 'Re-Write OST', ['Theme - Live','Theme - Remix']],
  ];
  for (const [video, parts, expectedGroup, expectedSongs] of cases) {
    const group = names.getBilibiliCollectionTitle(video, parts);
    assert.equal(group,expectedGroup,video);
    assert.deepEqual(parts.map(part=>names.getBilibiliTrackTitle(part,group)),expectedSongs,video);
  }
});

test('ambiguous subtitles, versions, numbers and unrelated shared words are preserved', () => {
  const names = createRuntime()('src/services/songMetadata.ts');
  for (const title of ['Re-Write - Live','99 Luftballons','1984','Gate of Steiner (Remix)','Theme - Acoustic']) {
    assert.equal(names.getBilibiliTrackTitle(title,'其他作品原声'),title);
  }
  assert.equal(names.getBilibiliCollectionTitle('作品精选',['Love - Hate','Love - Story']),'作品精选');
  assert.equal(names.getBilibiliCollectionTitle('Theme - Live',['Theme - Live','Theme - Remix']),'Theme - Live');
});

test('generic rules apply to new factories, existing queues and snapshot recovery with originals intact', () => {
  const runner = createHooks();
  const load = createRuntime({ react:runner.hooks,'src/services/utils.ts':{} });
  const factory=load('src/services/songFactory.ts'),store=load('src/services/libraryStore.ts');
  const pages=[{cid:1,part:'Different Album - First Song'},{cid:2,part:'Different Album - Second Song (Live)'}];
  const video={bvid:'BVgeneric',title:pages[0].part,pages};
  const rows=pages.map(page=>factory.createBilibiliSong(video,{url:'bili-audio://test',cid:page.cid},page));
  assert.deepEqual(rows.map(s=>s.title),['First Song','Second Song (Live)']);
  const old=rows.map(s=>({...s,title:s.originalTitle}));
  const {useQueueState}=load('src/hooks/useQueueState.ts');runner.mount(useQueueState);
  runner.current.setQueue(old);runner.flush();
  assert.deepEqual(Array.from(runner.current.queue,s=>s.title),['First Song','Second Song (Live)']);
  assert.equal(runner.current.queue[0].originalTitle,pages[0].part);
  const again=runner.current.queue;runner.current.setQueue(again);runner.flush();assert.equal(runner.current.queue,again);
  runner.current.setQueue(old.map(s=>store.fromStoredSong(store.toStoredSong(s))));runner.flush();
  assert.deepEqual(Array.from(runner.current.queue,s=>s.title),['First Song','Second Song (Live)']);
  assert.equal(runner.current.queue[1].biliVideoTitle,video.title);
});
