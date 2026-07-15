## BiliMusic v1.0.2 更新日志

### 🐛 Bug 修复

**播放列表**
- 修复删除歌曲时可能导致音频中断的问题
- 修复侧边栏交互时的抽动和闪动问题
- 优化侧边栏悬停效果，减少布局抖动

**搜索功能**
- 修复 B 站搜索结果的布局问题，现在正确显示在滚动区域内

### ⚡ 性能优化

**歌词显示**
- 优化 LyricsView 渲染性能，减少每帧计算量
- 使用对象池复用数组，降低 GC 压力
- 将排序算法从快速排序替换为插入排序（对小数组更高效）

### ✨ 功能改进

**搜索体验**
- 添加"加载更多"按钮，支持手动加载更多搜索结果
- 优化无限滚动触发阈值，提前加载内容

**开发体验**
- 添加 `.gitignore` 文件，规范版本控制
- 添加代码签名配置指南 (`CODE_SIGNING.md`)
- 添加项目开发记录 (`PROJECT_LOG.md`)
- 提供自签名证书生成脚本

### 📁 文件变更

```
新增:
- .gitignore
- CODE_SIGNING.md
- PROJECT_LOG.md
- scripts/create-self-signed-cert.ps1

修改:
- package.json (版本号 1.0.1 → 1.0.2)
- src/components/LyricsView.tsx (性能优化)
- src/components/PlaylistPanel.tsx (Bug修复)
- src/components/SearchModal.tsx (UI修复)
- src/hooks/usePlaylist.ts (Bug修复)
- src/hooks/useSearchModal.ts (功能改进)
```

### 📝 备注

- 本次更新为累积修复版本，建议所有用户升级
- Windows 安全警告将在购买代码签名证书后解决
- 详见 `CODE_SIGNING.md` 了解代码签名配置

---

**下载**: [BiliMusic 1.0.2.exe](https://github.com/dujiandjdu-source/BiliMusic/releases/download/v1.0.2/BiliMusic%201.0.2.exe)

**完整变更**: [v1.0.1...v1.0.2](https://github.com/dujiandjdu-source/BiliMusic/compare/v1.0.1...v1.0.2)
