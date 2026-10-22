# 共享模块维护

Edge 和 Obsidian 各自携带可独立发布的模块；`shared-modules.json` 记录需要保持一致的纯逻辑及 SHA-256。宿主授权、网络下载和界面桥接分别维护。

- `npm test` 同时检查本仓库共享模块与记录是否一致。
- `npm run check:shared -- --peer "另一个项目的路径"` 只读比较两个项目的模块内容，不依赖项目目录名称。
- 修改共享逻辑时，在两端同步对应模块及回归测试，运行两端测试，再执行 `node scripts/check-shared.cjs --record --peer "另一个项目的路径"` 更新本仓库记录。在另一仓库执行相同命令，最后检查差异。
- `--record` 仅更新本地校验记录；不会复制、覆盖对方代码，也不会提交或推送。

主要协议：`chat-sync.js` 的版本与三方合并、`context-budget.js` 的完整回合预算、`token-policy.js` 的刷新时机，以及联网解析与诊断模块。聊天存储操作必须继续由宿主串行执行。
