/**
 * Minimal type-safe i18n for dsh-obsidian (en / zh).
 * Modeled after claudian's i18n core but trimmed to the essentials.
 */

export type Locale = 'en' | 'zh';

const translations = {
  en: {
    'chat.title': 'Harness Chat',
    'chat.placeholder': 'Ask DeepSeek Harness to work on your vault…',
    'chat.send': 'Send',
    'chat.stop': 'Stop',
    'chat.clear': 'Clear conversation',
    'chat.cleared': 'Conversation cleared',
    'chat.running': 'Running…',
    'chat.starting': 'Starting DeepSeek Harness…',
    'chat.thinking': 'Agent is working…',
    'chat.completed': 'Completed in {duration}s',
    'chat.failed': 'Run failed: {message}',
    'chat.cancelled': 'Run stopped by user',
    'chat.copy': 'Copy',
    'chat.copied': 'Copied to clipboard',
    'chat.saveNote': 'Save as note',
    'chat.saveNoteTitle': 'Save as note',
    'chat.saveNotePrompt': 'Note title:',
    'chat.saved': 'Note created',
    'chat.busy': 'A task is already running',
    'chat.noDsh': 'DeepSeek Harness (dsh) not found. Install with: npm i -g @deepseek-ai/dsh, then configure its path in settings.',
    'chat.noCredential': 'No model credential found for DeepSeek Harness. Configure it in the DSH web (Models page) or export DEEPSEEK_API_KEY.',
    'chat.memoryPrefix': '[Conversation memory]\n{memory}\n\n',
    'settings.dshBin.name': 'dsh binary path',
    'settings.dshBin.desc': 'Leave empty to auto-detect from PATH.',
    'settings.dshBin.placeholder': '/usr/local/bin/dsh',
    'settings.dshHome.name': 'DSH_HOME',
    'settings.dshHome.desc': 'Where dsh stores credentials and config (default: ~/.dsh).',
    'settings.dshHome.placeholder': '~/.dsh',
    'settings.workdir.name': 'Working directory',
    'settings.workdir.desc': 'Directory the agent works on. Empty = vault root. Use a relative subfolder like "Projects" to scope the agent.',
    'settings.workdir.placeholder': '(vault root)',
    'settings.timeout.name': 'Task timeout (seconds)',
    'settings.timeout.desc': 'Automatically stops the run after this duration.',
    'settings.memory.name': 'Conversation memory',
    'settings.memory.desc': 'Feed a summary of earlier turns back into each new task.',
    'settings.language.name': 'Language',
    'settings.language.desc': 'Plugin UI language.',
    'settings.persona.name': 'Custom persona',
    'settings.persona.desc': 'Extra instructions appended to the agent system prompt.',
    'settings.persona.placeholder': 'Always answer in Chinese…',
    'settings.check.title': 'Environment check',
    'settings.check.run': 'Run check',
    'settings.check.ok': '✓ dsh found at {path}',
    'settings.check.missing': '✗ dsh not found. Install: npm i -g @deepseek-ai/dsh',
    'settings.check.help': 'Run this check after installing dsh.',
    'settings.footer': 'Powered by DeepSeek Harness',
  },
  zh: {
    'chat.title': 'Harness 聊天',
    'chat.placeholder': '让 DeepSeek Harness 在你的 vault 里干活…',
    'chat.send': '发送',
    'chat.stop': '停止',
    'chat.clear': '清空对话',
    'chat.cleared': '对话已清空',
    'chat.running': '运行中…',
    'chat.starting': '正在启动 DeepSeek Harness…',
    'chat.thinking': 'Agent 正在工作…',
    'chat.completed': '完成,耗时 {duration} 秒',
    'chat.failed': '运行失败:{message}',
    'chat.cancelled': '已停止',
    'chat.copy': '复制',
    'chat.copied': '已复制到剪贴板',
    'chat.saveNote': '存为笔记',
    'chat.saveNoteTitle': '存为笔记',
    'chat.saveNotePrompt': '笔记标题:',
    'chat.saved': '笔记已创建',
    'chat.busy': '已有任务正在运行',
    'chat.noDsh': '未找到 DeepSeek Harness(dsh)。请先安装:npm i -g @deepseek-ai/dsh,并在设置中配置路径。',
    'chat.noCredential': '未找到 DeepSeek Harness 的模型凭据。请在 DSH web(Models 页)配置,或导出 DEEPSEEK_API_KEY。',
    'chat.memoryPrefix': '[对话记忆]\n{memory}\n\n',
    'settings.dshBin.name': 'dsh 可执行文件路径',
    'settings.dshBin.desc': '留空则从 PATH 自动探测。',
    'settings.dshBin.placeholder': '/usr/local/bin/dsh',
    'settings.dshHome.name': 'DSH_HOME',
    'settings.dshHome.desc': 'dsh 存放凭据与配置的目录(默认 ~/.dsh)。',
    'settings.dshHome.placeholder': '~/.dsh',
    'settings.workdir.name': '工作目录',
    'settings.workdir.desc': 'agent 工作的目录。留空 = vault 根目录;填写相对子目录(如 "Projects")可限定范围。',
    'settings.workdir.placeholder': '(vault 根目录)',
    'settings.timeout.name': '任务超时(秒)',
    'settings.timeout.desc': '超过该时长自动停止运行。',
    'settings.memory.name': '对话记忆',
    'settings.memory.desc': '把之前轮次的要点摘要回填到每个新任务。',
    'settings.language.name': '语言',
    'settings.language.desc': '插件界面语言。',
    'settings.persona.name': '自定义 persona',
    'settings.persona.desc': '追加到 agent 系统提示词中的额外指令。',
    'settings.persona.placeholder': '始终用中文回答…',
    'settings.check.title': '环境检查',
    'settings.check.run': '运行检查',
    'settings.check.ok': '✓ 已找到 dsh:{path}',
    'settings.check.missing': '✗ 未找到 dsh。安装:npm i -g @deepseek-ai/dsh',
    'settings.check.help': '安装 dsh 后运行此检查。',
    'settings.footer': '由 DeepSeek Harness 驱动',
  },
} as const;

export type TranslationKey = keyof typeof translations['en'];
type Params = Record<string, string | number>;

let currentLocale: Locale = 'en';

export function t(key: TranslationKey, params?: Params): string {
  const table = translations[currentLocale] ?? translations.en;
  let str: string = table[key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  return str;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Resolve Obsidian's UI locale to one we support. */
export function resolveLocale(obsidianLang: string, override: string): Locale {
  if (override === 'zh') return 'zh';
  if (override === 'en') return 'en';
  if (obsidianLang.toLowerCase().startsWith('zh')) return 'zh';
  return 'en';
}
