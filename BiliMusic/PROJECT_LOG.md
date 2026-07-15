# BiliMusic 项目开发记录

## 项目信息
- **项目名称**: BiliMusic
- **版本**: 1.0.1
- **路径**: E:\MusicApp\BiliMusic
- **GitHub**: https://github.com/dujiandjdu-source/BiliMusic
- **最后打包**: 2026-07-15 17:10

## 开发流程规范

### 每次任务执行流程
1. ✅ 完成代码修改
2. ✅ 运行 `npm run check` 检查 TypeScript 编译
3. ✅ 运行 `npm run pack:portable` 重新打包
4. ✅ 测试新生成的 exe 文件
5. ⏸️ **不上传 GitHub**（本地开发阶段）

### 生成的 exe 文件位置
```
E:\MusicApp\BiliMusic\release\BiliMusic 1.0.1.exe
```

## 已完成的修复和优化

### 2026-07-15

#### 1. 添加 .gitignore
- 排除 node_modules, dist, release, .env 等
- 排除证书文件 (*.pfx, *.pem)

#### 2. 修复 usePlaylist.ts 删除歌曲Bug
- 问题：`setQueue` 回调中直接操作 `audioResourceCache`
- 修复：将资源释放逻辑移到 `setQueue` 外部

#### 3. 优化 LyricsView.tsx 性能
- 使用对象池复用 queue 数组
- 将 Array.sort() 替换为插入排序
- 优化 willChange 和 transition 属性

#### 4. 修复 B站搜索UI问题
- 问题：Bilibili Results 被错误地放在滚动区域外部
- 修复：将其移入正确的 Results Area 容器

#### 5. 修复侧边栏交互抽动
- 优化 willChange 属性（仅在拖拽时使用）
- 使用 RAF 节流 ResizeObserver 回调

#### 6. 搜索功能添加加载更多
- 优化滚动触发阈值（100px → 200px）
- 添加可点击的"加载更多"按钮

#### 7. 配置 Windows 代码签名
- 创建 CODE_SIGNING.md 配置指南
- 创建 scripts/create-self-signed-cert.ps1 脚本

#### 8. 修复侧边栏悬停闪动
- 添加 `will-change-transform` 优化音频指示器动画
- 使用 `invisible` + `visible` 替代 opacity 切换
- 添加 `overflow-hidden` 防止布局抖动

## 待办事项

### 高优先级
- [ ] 测试侧边栏悬停闪动修复效果
- [ ] 考虑添加单元测试

### 中优先级
- [ ] 配置代码签名证书
- [ ] 添加 GitHub Actions CI/CD

### 低优先级
- [ ] 支持 macOS/Linux 构建
- [ ] 添加更多歌词格式支持

## 注意事项

1. **不上传 GitHub**: 当前处于本地开发阶段，所有修改暂不上传
2. **备份用户数据**: 清理冗余文件时保留用户数据（%APPDATA%/bili-music）
3. **测试后再打包**: 每次修改后先运行 `npm run check` 验证

## 相关文件

### 关键配置文件
- `package.json` - 项目配置和脚本
- `vite.config.ts` - 构建配置
- `electron/main.cjs` - Electron 主进程

### 文档文件
- `README.md` - 用户使用文档
- `CODE_SIGNING.md` - 代码签名配置指南
- `PROJECT_LOG.md` - 本项目记录文件

### 脚本文件
- `scripts/create-self-signed-cert.ps1` - 生成自签名证书
