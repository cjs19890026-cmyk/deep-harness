# 发布到 Obsidian 社区插件市场 — 检查清单(2025 新版目录流程)

> 流程依据:[官方提交指南](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) 与
> [插件提交要求](https://docs.obsidian.md/Community+directory/Submission+requirements+for+plugins)。
> ⚠️ **旧版「fork obsidian-releases 提交 PR」流程已废弃**——上游已关闭 PR
> (`has_pull_requests: false`),现在通过 **community.obsidian.md 目录**网页提交。

## 0. 发布前硬性检查(全部已完成 ✅)

- [x] GitHub 仓库 **public**:`cjs19890026-cmyk/dsh-obsidian-DeepHarness`
- [x] `manifest.json` 必备字段齐全
- [x] **插件 id 不含 "obsidian"**:`deepharness`(官方规则:id 不能包含 `obsidian`)
- [x] id 全局唯一(已查 community-plugins.json 无冲突)
- [x] `description` ≤250 字符、动作式开头、以句号结尾、无 emoji
- [x] `isDesktopOnly: true`(使用 Node/Electron API)
- [x] 命令 id 不含插件 id(`open-harness-chat` / `ask-active-note` ✓,Obsidian 会自动加前缀)
- [x] `LICENSE`(MIT)、英文 `README.md` + 中文 `readme-ch.md`
- [x] `npm run build` production 构建通过,52 tests 全过

## 1. 创建 GitHub Release(已自动化 ✅)

已配置官方 [GitHub Actions 工作流](.github/workflows/release.yml):**推 tag → 自动构建 → 产物 attestation → 草稿 Release(三件套)→ 手动发布**。已验证 0.1.0 全流程通过。

发布新版本:

```bash
git tag -a <版本> -m <版本>   # 如 0.1.1;tag 必须等于 manifest version,不带 v
git push origin <版本>
# Actions 自动完成构建;完成后到 Releases 页编辑草稿,补 release notes 并 Publish
```

已发布:https://github.com/cjs19890026-cmyk/dsh-obsidian-DeepHarness/releases/tag/0.1.0

## 2. 通过 Obsidian 社区目录提交(网页操作,需你的 Obsidian 账号)

1. 打开 [community.obsidian.md](https://community.obsidian.md) 并用 **Obsidian 账号**登录
2. 进入你的 **Community profile** 页(左侧栏 Profile),在 **GitHub** 区块点 **Connect** 关联 GitHub 账号(目录需要只读验证你拥有仓库;这是在社区目录资料页,不是 obsidian.md 账号页)
3. 在左侧栏 **Plugins** 页选 **New plugin** 添加:
   - 仓库 URL:`https://github.com/cjs19890026-cmyk/dsh-obsidian-DeepHarness`
   - 目录会读取默认分支 HEAD 上的 `manifest.json`(id `deepharness`、version `0.1.0`)
4. 提交后触发**自动审查**(含 artifact attestation 校验),目录页面会显示需修正的指引:
   - 有错误 → 修仓库 + 发新版本 Release(版本号递增)
   - 无错误 → 可编辑描述并点击 **Publish**
5. 审查通过并发布后,用户在 Obsidian 设置 → 第三方插件 → 浏览 中搜索 "DeepHarness" 即可安装

## 3. 后续更新(每次发版)

1. bump `manifest.json` + `package.json` 的 version(如 `0.1.1`)并提交推送
2. `git tag -a <版本> -m <版本> && git push origin <版本>` → Actions 自动构建草稿
3. Releases 页编辑草稿补 release notes → Publish
4. 用户端自动检测到更新(无需重新提交目录)

## 常见被拒/失败原因

| 原因 | 说明 |
|---|---|
| tag 带 `v` 前缀 | 必须与 manifest version 完全一致,如 `0.1.0` |
| Release 缺 `main.js` | 三件套缺一不可 |
| 仓库 private | 目录无法访问 |
| id 含 "obsidian" | 官方硬性规则,已规避(id = `deepharness`) |
| 描述夸大 | 描述会被当作声明与代码核对;我们的描述与功能一一对应 |
| version 不一致 | manifest version 必须等于 release tag |
