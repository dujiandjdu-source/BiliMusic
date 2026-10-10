import React, { useRef, useState } from 'react';
import type { MusicLibrary, Song } from '../types';
import { exportLibraryBackup, previewLibraryBackup, restorePreviewedBackup, type BackupPreview } from '../services/libraryBackup';

interface Props {
  songs: Song[];
  queue: Song[];
  library: MusicLibrary;
  onBeforeRestore: () => void;
}

const LibraryBackupSettings: React.FC<Props> = ({ songs, queue, library, onBeforeRestore }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const exportBackup = async () => {
    if (busy) return;
    setBusy(true); setMessage('正在读取音频并生成备份…');
    try {
      const backup = await exportLibraryBackup(queue, library, songs);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `BiliMusic-Backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage('完整备份已生成，请保存下载文件。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '备份失败'); }
    finally { setBusy(false); }
  };
  const readBackup = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true); setMessage('正在校验备份…'); setPreview(null);
    try {
      setPreview(previewLibraryBackup(JSON.parse(await file.text())));
      setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : '备份读取失败'); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!preview || busy) return;
    setBusy(true); setMessage('正在恢复，请勿关闭程序…');
    try {
      onBeforeRestore();
      await restorePreviewedBackup(preview);
      // Reload immediately after the atomic commit; no stale hook state is republished.
      window.location.reload();
    } catch (error) {
      setMessage(`恢复失败，原音乐库保留。${error instanceof Error ? error.message : ''}`);
      setBusy(false);
    }
  };
  return <section className="space-y-3 rounded-2xl border border-white/8 bg-white/5 p-4" aria-label="完整备份恢复">
    <h3 className="font-semibold">完整备份与恢复</h3>
    <p className="text-xs text-white/50">保存歌曲、应用内本地音频、队列、收藏、歌单、历史、歌词校准及偏好设置。备份保存在你选择的位置。</p>
    <div className="flex flex-wrap gap-2">
      <button disabled={busy} onClick={exportBackup} className="rounded-lg bg-white/8 px-3 py-2 text-sm disabled:opacity-40">导出完整备份</button>
      <button disabled={busy} onClick={() => inputRef.current?.click()} className="rounded-lg bg-white/8 px-3 py-2 text-sm disabled:opacity-40">预览备份文件</button>
      <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" aria-label="选择完整备份"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readBackup(file); }} />
    </div>
    {preview && <div className="space-y-2 rounded-xl border border-white/10 p-3" aria-label="备份恢复预览">
      <p className="text-sm">备份时间：{new Date(preview.exportedAt).toLocaleString()}</p>
      <p className="text-sm">{preview.snapshot.songs!.length} 首歌曲 · 队列 {preview.snapshot.queue.length} 首 · {preview.snapshot.library.playlists.length} 个歌单</p>
      <p className="text-xs text-white/60">本地音频 {preview.files.length} 个（{(preview.audioBytes / 1024 / 1024).toFixed(1)} MB）· 喜欢 {preview.snapshot.library.likedSongIds.length} 首 · 收藏 {preview.snapshot.library.favoriteSongIds.length} 首</p>
      <ul className="max-h-32 overflow-auto text-xs text-white/60">{preview.snapshot.songs!.slice(0, 30).map(song => <li key={song.id}>{song.title} · {song.artist}</li>)}</ul>
      {preview.snapshot.songs!.length > 30 && <p className="text-xs text-white/40">仅展示前 30 首，恢复包含全部歌曲。</p>}
      <p className="text-xs text-amber-200">确认后替换当前 {songs.length} 首歌曲及对应队列、收藏、歌单、历史和偏好设置，完成后自动重新加载。原始音乐文件保留。</p>
      <div className="flex gap-2">
        <button disabled={busy} onClick={restore} className="rounded-lg bg-amber-200/15 px-3 py-2 text-sm disabled:opacity-40">确认替换并恢复</button>
        <button disabled={busy} onClick={() => { setPreview(null); setMessage('已取消，音乐库未修改。'); }} className="rounded-lg bg-white/8 px-3 py-2 text-sm disabled:opacity-40">取消恢复</button>
      </div>
    </div>}
    {message && <p role="status" className="text-xs text-white/70">{message}</p>}
  </section>;
};

export default LibraryBackupSettings;
