# 发布到 Obsidian 社区插件市场 — 检查清单与 PR 模板

> 流程依据:obsidianmd/obsidian-releases 的提交指南与自动验证规则。
> 核心机制:公开仓库 + GitHub Release(带 main.js / manifest.json / styles.css)
> + 向 [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 提交登记 PR。

## 0. 发布前硬性检查

- [ ] GitHub 仓库为 **public**(当前仓库默认是 private,发布前必须转公开)
- [ ] `manifest.json` 的 `id` / `name` / `version` / `minAppVersion` / `description` / `author` / `isDesktopOnly` 齐全
- [ ] 仓库根目录有 `LICENSE` 文件
- [ ] `npm run build` 成功,`dist/main.js` 为 production 构建(已 minify)

## 1. 创建 Release(核心步骤)

1. 提交并推送代码到 `main`
2. 在 GitHub 上创建 Release:
   - **Tag 必须等于 manifest 的 version,如 `0.1.0` —— 绝不能带 `v` 前缀**
   - Release 附件必须包含三个文件(取自 `dist/`):
     - `main.js`
     - `manifest.json`
     - `styles.css`
   - 自动验证器从 release assets 读取这三个文件,漏任何一个都会失败

## 2. 向 obsidian-releases 提交登记 PR

1. fork `https://github.com/obsidianmd/obsidian-releases`
2. 编辑根目录 `community-plugins.json`,追加以下条目(JSON,放在数组末尾):

```json
{
  "id": "dsh-obsidian",
  "name": "DeepHarness",
  "author": "cjs19890026-cmyk",
  "description": "Embeds DeepSeek Harness as an AI collaborator in your vault: chat with a full agent (bash, web search, file tools) that works on your notes.",
  "repo": "cjs19890026-cmyk/dsh-obsidian-DeepHarness",
  "branch": "main"
}
```

3. PR 标题:

```
Add dsh-obsidian (DeepHarness)
```

4. PR 描述模板:

```markdown
## Plugin
**name**: DeepHarness
**id**: dsh-obsidian
**repo**: cjs19890026-cmyk/dsh-obsidian-DeepHarness
**branch**: main

## Description
An Obsidian plugin that embeds DeepSeek Harness (dsh) as an AI collaborator
in the vault: it spawns `dsh --profile headless` as a child process and lets
the agent work on notes with its full toolset (bash, file tools, web search).

## Security notes
- No API keys are collected or transmitted by the plugin: credentials are
  read by the dsh CLI from the user's local DSH_HOME (~/.dsh) or env vars.
- The plugin only spawns a local `dsh` subprocess and renders its stdout;
  no network requests are made by the plugin itself.
- File access is scoped by the user-selected sandbox mode (read-only /
  workspace-write / danger-full-access).
```

## 3. 通过后

- 插件出现在 Obsidian 社区插件列表(目录刷新有延迟,几小时到几天)
- 用户可在:设置 → 第三方插件 → 浏览 中搜索 "DeepHarness" 安装

## 4. 日常更新(后续每次发版)

1. bump `manifest.json` + `package.json` 的 version
2. `npm run build`
3. 推送代码
4. 创建 Release:**tag = 新版本号(无 v 前缀)**,附件带 `main.js` / `manifest.json` / `styles.css`
5. 用户端自动检测到更新(无需再次提交 PR)

## 常见被拒原因

| 原因 | 说明 |
|---|---|
| Tag 带 `v` 前缀 | 必须与 manifest version 完全一致,如 `0.1.0` |
| Release 缺少 `main.js` | 三个附件缺一不可 |
| 仓库是 private | 必须 public 才能被验证器访问 |
| version 不一致 | manifest 里的 version 必须等于 tag |
| 与现有插件重名/同 id | id 必须全局唯一 |
