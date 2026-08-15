# obsidian-harness-chat

在 Obsidian 中直接调用 **DeepSeek Harness** 的插件:向侧边栏聊天窗发送任务,DSH agent
以你的 vault 为工作目录,用完整工具集(bash、文件读写、web 搜索、子代理等)自主执行。

> 设计文档见 [`DESIGN.md`](./DESIGN.md)。本仓库基于对
> [Enigmora/claudian](https://github.com/Enigmora/claudian) 源码的分析而设计,
> 关键区别:**执行层下沉到 DSH 运行时**,插件只做进程桥接与 UI。

## 原理

```
Obsidian 插件 ──spawn──▶ dsh --profile headless --patch <vault.yml> "<任务>"
                            │ cwd = vault 根目录
                            │ DSH_HOME = ~/.dsh(复用你的凭据/模型配置)
                            ▼
                    DeepSeek Harness agent
                    bash │ 文件工具 │ web_search │ 子代理 …
```

已在本机验证:`dsh --profile headless "用 bash 运行 pwd 和 ls…"` 端到端成功。

## 前置条件

1. 安装 DSH CLI:

   ```bash
   npm i -g @deepseek-ai/dsh
   ```

2. 配置模型凭据(任选其一):
   - DSH web(Models 页)写入 `~/.dsh/.credentials.yaml`
   - 或导出环境变量 `DEEPSEEK_API_KEY`

3. 插件设置页点「运行检查」确认 `dsh` 可探测到。

## 安装(开发)

```bash
npm install
npm run build
# 复制到 vault:
cp -r dist /path/to/vault/.obsidian/plugins/dsh-obsidian/
```

启用插件后,点击左侧 ribbon 的 bot 图标打开聊天面板。

## 功能

- 💬 聊天面板:发送任务 → 状态指示(启动/思考/耗时)→ Markdown 渲染结果
- 🧠 **模型选择器**:聊天面板顶栏可切换 **DeepSeek V4 Flash / DeepSeek V4 Pro**
- ⚙️ **推理等级 (Thinking)**:顶栏可切换 **off / high / max**
  - 通过插件专属 DSH_HOME(`dsh-home/` 目录)写入 `agent-default-model` 配置,凭据软链复用 `~/.dsh`,**不污染**全局 DSH 设置
- ⏹ 停止按钮(SIGTERM 终止运行)、超时兜底(默认 10 分钟)
- 📝 对话记忆:前几轮要点自动回填到新任务
- 🕘 会话历史:对话按「会话」归档,历史面板支持恢复/置顶/重命名/备注;当前会话每轮完成后实时原子落盘,退出/崩溃/重载后未归档的会话会在下次启动自动补进历史,不丢记录
- 📋 结果一键「复制 / 存为笔记」;界面文本支持光标选择
- ⚙️ 命令:「让 Harness 处理当前笔记」
- 🗂 生成的 vault persona(`.obsidian/plugins/dsh-obsidian/generated/vault.yml`)
  约束 agent 使用 wikilink、破坏性操作先征得同意;可自行编辑
- 🌐 界面 i18n(en / 中文)

## 设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| dsh 二进制路径 | 自动探测 | 留空 = PATH |
| Node.js 路径 | 自动探测 | 插件用 node 直接运行 dsh 脚本(绕过 Obsidian 受限 PATH 的 shebang 问题) |
| DSH_HOME | `~/.dsh` | 凭据/配置根 |
| 工作目录 | vault 根 | 可填相对子目录限定 agent 范围 |
| 任务超时 | 600s | 超时自动停止 |
| 对话记忆 | 开 | 上下文回填 |
| 工具执行模式 | 默认 (native) | native / code / both(工具后端,非文件沙箱) |
| 模型 (Model) | DeepSeek V4 Flash | 默认模型,顶栏可快速切换 |
| 推理等级 (Thinking) | high | off / high / max,顶栏可切换 |
| 安全模式 (Security) | 工作区写入 | 只读 / 工作区写入 / 完全访问 |
| 显示思考过程 | 开 | 回答前显示可折叠思考过程 |
| 显示工具调用 | 开 | 执行 bash/文件等工具时显示调用记录 |
| 历史记录条数 | 50 | 历史面板最多保留的会话数,超出删最旧 |
| 自定义 persona | 空 | 追加指令 |

## 安全

- agent 的文件工具以 vault 为工作区;**但 bash 工具拥有用户级权限**(headless 默认无文件沙箱),persona 规则要求 agent 不修改 vault 外文件、破坏性操作先征得同意
- 插件不收集任何 API Key,凭据全部走 DSH 既有配置
- 卸载插件时终止所有子进程

## 路线图

- **Phase 2**(已基本完成):流式输出、工具调用日志、会话历史(持久化)
  - 剩余:文件修改 diff 确认
- **Phase 3**:批量处理 vault 笔记、长期记忆(`Harness/memory.md`)、运行历史

详见 [`DESIGN.md`](./DESIGN.md) 第 8 节。

## 许可

MIT
