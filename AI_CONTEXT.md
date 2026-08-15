# AI_CONTEXT.md — 项目稳定上下文

> **给每次新对话的第一份文档**。先读这份 + 本地 `MAINTENANCE.md` 顶部的交接摘要,
> 即可恢复全部上下文,无需重新理解整个项目。
> 本文件只写**稳定信息**;每次修改的日志与交接摘要见本地维护文档(不上线)。

## 一句话定位

**DeepHarness**(插件 id `dsh-obsidian`)是一个 Obsidian 插件:spawn `dsh --profile headless`
子进程,把 DeepSeek Harness 的完整 agent 能力(bash、文件工具、web 搜索、子代理)
接入用户的 vault。定位对标 [Claudian](https://github.com/yishentu/claudian)(Claude Code 版),
但执行层下沉到 DSH 运行时,插件只做进程桥接与 UI。

## 项目结构

```
src/main.ts          插件入口:视图注册、ribbon、命令、设置加载、vault 根目录
src/chat-view.ts     聊天 UI:流式渲染、思考/工具块、历史面板、会话恢复、欢迎区
src/dsh-client.ts    子进程桥:spawn node <dsh>/bin.js --profile headless,超时/取消
src/dsh-runner.ts    二进制探测、--patch 覆盖层生成(persona + stream-relay)、隔离 DSH_HOME
src/history.ts       会话历史:原子落盘、置顶/重命名/备注/恢复
src/context-meter.ts 上下文用量环(按模型各自的上下文窗口估算)
src/mention.ts       @ 提及:输入框 @ 弹 vault 笔记列表,选中生成 [[wikilink]]
src/modals.ts        独立 Modal 组件(NoteCreator / SecurityConfirm 等,自 chat-view 抽出)
src/pure.ts          无 Obsidian 依赖的纯函数(可单测,如 parseHeadlessOutput / 错误分类)
src/pure.test.ts     vitest 单元测试
src/settings.ts      设置项 + 设置页 UI
src/i18n/index.ts    en/zh 双语,TranslationKey 类型约束
styles.css           全部样式(类前缀 dsh-)
esbuild.config.mjs   构建脚本(production 压缩)
deploy.sh            构建 + 部署到指定 vault
README.md / README_EN.md  中文 / 英文双语文档(顶部互链)
docs/publish-checklist.md  发布到社区市场的检查清单与 PR 模板
MAINTENANCE.md       本地维护日志(被 .gitignore 忽略,不上线)
```

## 技术栈

- TypeScript + esbuild(单文件 bundle → `dist/main.js`,CJS)
- Obsidian API(ItemView / Plugin / MarkdownRenderer / Menu / Modal)
- Node.js `child_process` 桥接 DSH CLI;**无任何前端框架**
- vitest(纯函数单元测试,`npm test`);无运行时依赖;nodeBuiltins 全部 external,不打进 bundle

## 重要约定

1. **执行层下沉**:插件绝不自己实现 agent 逻辑,只 spawn `dsh` 并渲染 stdout/事件流
2. **node 直跑 dsh 脚本**:`node <realpath>/bin.js`(绕过 Electron 受限 PATH 的 shebang 问题)
3. **隔离 DSH_HOME**:每任务写 `dsh-home/settings.yaml`(model + reasoningEffort),
   凭据软链复用用户 `~/.dsh`,不污染全局配置
4. **patch 覆盖层**(`generated/` 目录):
   - `vault.yml` = persona(用户可编辑,插件不覆盖)
   - `stream-relay.js` + `stream.yml` = 插件管理的流式中继,stdout 输出 `DLEVENT\t<json>`
     事件(think / tool),headless 本身无流式
5. **i18n**:所有用户可见文案必须走 `t()`;新增 key 必须 en + zh 同时加
6. **历史持久化**:原子写(tmp + rename)+ 同步写(`onunload` 是 void,Obsidian 不 await)
7. **显示名 DeepHarness**,插件 id / 文件夹名 `dsh-obsidian` 永远不变(路径依赖)

## 常见命令

```bash
npm run build            # production 构建 → dist/
npm run dev              # 开发构建(不压缩,inline sourcemap)
npm test                 # vitest 单元测试(src/pure.test.ts)
npx tsc --noEmit         # 类型检查
./deploy.sh <vault路径>   # 构建 + 复制到 vault 插件目录
# 部署后必须:设置 → 第三方插件 → 禁用再启用该插件(或 Cmd+Q 完全退出 Obsidian)
```

## 不能改的边界(红线)

- 插件 `id` 与文件夹名 `dsh-obsidian`:history.json、dsh-home、generated 的绝对路径依赖它
- `nodeBuiltins` 与 `obsidian` 必须保持 external,禁止打进 bundle
- **不收集 API Key**:凭据只走用户本地 DSH_HOME / 环境变量,插件无外发网络请求
- `DSH_PERMISSION_MODE`(沙箱模式)≠ `DSH_TOOLS_MODE`(工具后端),勿混淆(曾有历史 bug)
- `onunload()` 必须同步完成,不能 await
- 破坏性操作须先征得用户同意;切到「完全访问」必须先弹确认框
- 欢迎区/输入框保持极简(品牌极简方向),示例卡片已删除,勿加回

## 发布相关

发布到社区市场的完整步骤见 `docs/publish-checklist.md`。要点:tag 不带 `v`、
Release 必须带 main.js/manifest.json/styles.css 三件套、仓库必须 public。

## 交接机制

每轮对话结束,把「交接摘要」(≤10 条:改了什么/当前状态/下一步)追加到
本地 `MAINTENANCE.md` 顶部。下次新对话:读本文件 + 摘要即可继续。
