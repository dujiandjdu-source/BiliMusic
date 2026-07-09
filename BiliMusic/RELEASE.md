# BiliMusic 1.0.1

## 更新内容
- 修复远程音乐缓存逻辑缺失导致的无法播放问题。
- 修复播放失败时状态仍显示播放中的问题。
- 修复内置 B 站视频模式，改为稳定的 webview 渲染方式。
- 收窄 Electron 响应头放宽逻辑，只作用于 B 站相关页面。
- 增加 Windows 便携版打包脚本：`npm run pack:portable`。

## 覆盖旧版本
1. 从 Git 仓库拉取最新代码。
2. 在 `BiliMusic` 目录运行 `npm install`。
3. 运行 `npm run pack:portable` 生成便携版 exe。
4. 用新的 exe 替换旧版本程序。
