const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' };
const request = async (ses, url) => {
  const response = await ses.fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw Error('网易云请求失败：'+response.status);
  const data = await response.json();
  if (data.code !== 200) throw Error('网易云接口暂不可用：'+data.code);
  return data;
};

const searchSongs = async (ses, keyword, limit = 20, offset = 0) => {
  if (typeof keyword !== 'string' || !keyword.trim()) return { result: { songs: [] } };
  const query = new URLSearchParams({ s: keyword.trim().slice(0, 300), type: '1',
    limit: String(Math.min(100, Math.max(1, Number(limit) || 20))), offset: String(Math.max(0, Number(offset) || 0)) });
  const data = await request(ses, 'https://music.163.com/api/search/get/web?'+query);
  return { result: { songs: (data.result?.songs ?? []).filter(song=>Number.isSafeInteger(song.id)).map(song=>({
    id: song.id, name: song.name, ar: song.ar ?? song.artists, al: song.al ?? song.album, dt: song.dt ?? song.duration,
  })) } };
};
const getLyrics = async (ses, id) => {
  if (typeof id !== 'string' || !/^\d{1,18}$/.test(id)) throw Error('歌曲 ID 无效');
  return request(ses, 'https://music.163.com/api/song/lyric?'+new URLSearchParams({id,lv:'-1',kv:'-1',tv:'-1'}));
};
module.exports = (ipc, ses) => {
  ipc.handle('netease:search-songs', (_event, keyword, limit, offset) => searchSongs(ses, keyword, limit, offset));
  ipc.handle('netease:lyrics', (_event, id) => getLyrics(ses, id));
};
module.exports._test = { searchSongs, getLyrics };
