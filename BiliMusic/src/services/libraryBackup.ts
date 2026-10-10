import type { MusicLibrary, Song } from '../types';
import { buildLibrarySnapshot, fromStoredSong, loadLocalFile, parseLibrarySnapshot,
  restoreLibraryBackup, loadPlaybackSnapshot, parsePlaybackSnapshot, savePlaybackSnapshot,
  type PlaybackSnapshot, type LibrarySnapshot } from './libraryStore';

export interface LibraryBackup {
  app: 'BiliMusic';
  kind: 'full-library-backup';
  version: 1;
  exportedAt: string;
  snapshot: LibrarySnapshot;
  playback?: PlaybackSnapshot;
  files: Array<{ id: string; mime: string; base64: string }>;
}

export interface BackupPreview {
  playback?: PlaybackSnapshot;
  snapshot: LibrarySnapshot;
  files: Array<{ id: string; file: Blob }>;
  exportedAt: string;
  audioBytes: number;
}

const encodeBlob = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error('读取本地音频失败'));
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.readAsDataURL(file);
});

/** Audio is included so a backup works on another machine, without relying on blob URLs. */
export const exportLibraryBackup = async (
  queue: Song[], library: MusicLibrary, songs: Song[],
): Promise<LibraryBackup> => {
  const snapshot = buildLibrarySnapshot(queue, library, songs);
  const playback = loadPlaybackSnapshot();
  const files: LibraryBackup['files'] = [];
  for (const song of snapshot.songs ?? []) {
    if (song.source !== 'local') continue;
    const file = await loadLocalFile(song.id);
    if (!file || !file.size) throw new Error(`本地音频缺失或为空：${song.title}。未生成不完整备份。`);
    files.push({ id: song.id, mime: file.type, base64: await encodeBlob(file) });
  }
  return { app: 'BiliMusic', kind: 'full-library-backup', version: 1,
    exportedAt: new Date().toISOString(), snapshot, files, playback };
};

/** Preview performs validation and decoding only; it never opens a database or mutates state. */
export const previewLibraryBackup = (raw: unknown): BackupPreview => {
  const fail = (reason: string): never => { throw new Error(`备份格式不正确：${reason}`); };
  if (!raw || typeof raw !== 'object') return fail('不是 BiliMusic 完整备份');
  const backup = raw as LibraryBackup;
  if (backup.app !== 'BiliMusic' || backup.kind !== 'full-library-backup' || backup.version !== 1)
    return fail('不支持的备份类型或版本');
  if (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt))) return fail('导出时间无效');
  const input = backup.snapshot;
  if (!input || input.version !== 2 || !Array.isArray(input.songs) || !Array.isArray(input.queue) ||
      !input.library || typeof input.library !== 'object' || !Array.isArray(backup.files)) return fail('缺少音乐库或文件列表');
  const incomingLibrary = input.library;
  const stringIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string');
  if (!incomingLibrary.profile || typeof incomingLibrary.profile.displayName !== 'string' || typeof incomingLibrary.profile.bio !== 'string' ||
      !stringIds(incomingLibrary.likedSongIds) || !stringIds(incomingLibrary.favoriteSongIds) ||
      !Array.isArray(incomingLibrary.playlists) || incomingLibrary.playlists.some(playlist => !playlist ||
        typeof playlist.id !== 'string' || typeof playlist.name !== 'string' || !stringIds(playlist.songIds)))
    return fail('个人资料、收藏或歌单信息无效');
  const snapshot = parseLibrarySnapshot(input)!;
  // A recovery must never silently lose invalid or duplicate rows.
  if (parseLibrarySnapshot({ songs: input.songs, queue: [] })!.songs!.length !== input.songs.length ||
      snapshot.songs!.length !== input.songs.length || snapshot.queue.length !== input.queue.length)
    return fail('歌曲编号重复或歌曲信息无效');
  const ids = new Set(input.songs.map(song => song.id));
  if (input.queue.some(song => !ids.has(song.id))) return fail('队列引用了不存在的歌曲');
  const library = snapshot.library;
  const refs = [...library.likedSongIds, ...library.favoriteSongIds,
    ...library.playlists.flatMap(playlist => playlist.songIds),
    ...(library.playHistory ?? []).map(entry => entry.songId),
    ...(library.playEvents ?? []).map(entry => entry.songId)];
  if (refs.some(id => !ids.has(id))) return fail('歌单、收藏或历史引用了不存在的歌曲');
  const localIds = new Set(snapshot.songs!.filter(song => song.source === 'local').map(song => song.id));
  if (snapshot.songs!.some(song => song.source !== 'local' && !fromStoredSong(song))) return fail('在线歌曲缺少来源');
  const files: BackupPreview['files'] = [];
  const seen = new Set<string>();
  let audioBytes = 0;
  for (const entry of backup.files) {
    if (!entry || typeof entry.id !== 'string' || !localIds.has(entry.id) || seen.has(entry.id)) return fail('音频文件编号无效或重复');
    if (typeof entry.mime !== 'string' || entry.mime.length > 200 || typeof entry.base64 !== 'string' ||
        !entry.base64.length || entry.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(entry.base64) ||
        entry.base64.slice(0, -2).includes('=') || /=[^=]$/.test(entry.base64))
      return fail('音频文件编码无效');
    // Decode in chunks to avoid large temporary strings and call-stack limits.
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (let start = 0; start < entry.base64.length; start += 65536) {
      let binary: string;
      try { binary = atob(entry.base64.slice(start, start + 65536)); }
      catch { return fail('音频文件编码无效'); }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      parts.push(bytes);
    }
    const file = new Blob(parts, { type: entry.mime });
    audioBytes += file.size;
    files.push({ id: entry.id, file });
    seen.add(entry.id);
  }
  if (seen.size !== localIds.size) return fail('缺少本地音频，无法完整恢复');
  const playback = backup.playback ? parsePlaybackSnapshot(JSON.stringify(backup.playback)) : undefined;
  if (playback?.songId && !ids.has(playback.songId)) return fail('播放位置引用了不存在的歌曲');
  return { snapshot, files, exportedAt: backup.exportedAt, audioBytes, playback };
};

export const restorePreviewedBackup = async (preview: BackupPreview): Promise<void> => {
  await restoreLibraryBackup(preview.snapshot, preview.files);
  if (preview.playback) savePlaybackSnapshot(preview.playback);
};
