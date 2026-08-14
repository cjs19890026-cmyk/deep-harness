import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { DshSettings, DshSettingTab, DEFAULT_SETTINGS, obsidianLocale } from './settings';
import { ChatView, VIEW_TYPE_CHAT } from './chat-view';
import { DshRunner } from './dsh-runner';
import { HistoryStore } from './history';
import { setLocale, resolveLocale } from './i18n';

export default class DshPlugin extends Plugin {
  settings: DshSettings;
  private runner: DshRunner;
  private vaultPatchInvalidated = false;
  history: HistoryStore | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyLocale();
    this.runner = new DshRunner(this.settings);

    // History store: human-readable task history in the plugin DSH_HOME.
    // NOTE: vault.adapter paths are relative to the vault root (not absolute).
    const historyFile = '.obsidian/plugins/dsh-obsidian/dsh-home/history.json';
    this.history = new HistoryStore(this.app, historyFile, this.settings.historyLimit);
    await this.history.load();

    // Register chat view
    this.registerView(VIEW_TYPE_CHAT, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));

    // Ribbon icon
    this.addRibbonIcon('bot', 'Harness Chat', () => {
      void this.activateChatView();
    });

    // Command: open chat
    this.addCommand({
      id: 'open-harness-chat',
      name: '打开 Harness 聊天',
      callback: () => {
        void this.activateChatView();
      },
    });

    // Command: ask about the active note
    this.addCommand({
      id: 'ask-active-note',
      name: '让 Harness 处理当前笔记',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension === 'md') {
          if (!checking) {
            void this.askWithActiveNote();
          }
          return true;
        }
        return false;
      },
    });

    this.addSettingTab(new DshSettingTab(this.app, this));
  }

  onunload(): void {
    // DshClient instances dispose their children in onClose;
    // nothing else to clean here.
  }

  /** Absolute filesystem path of the vault root. */
  getVaultRoot(): string {
    const adapter = this.app.vault.adapter as unknown as { getBasePath?: () => string };
    if (typeof adapter.getBasePath === 'function') {
      return adapter.getBasePath();
    }
    // Fallback: use the vault name under the default Obsidian location.
    return (this.app.vault.getName() || 'vault') as string;
  }

  /** Re-apply UI language from settings + Obsidian locale. */
  applyLocale(): void {
    const locale = resolveLocale(obsidianLocale(this.app), this.settings.language);
    setLocale(locale);
  }

  /** Force regeneration of the persona patch (custom persona changed). */
  invalidateVaultPatch(): void {
    this.vaultPatchInvalidated = true;
  }

  private async askWithActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const content = await this.app.vault.cachedRead(file);
    const prompt =
      `请分析当前笔记并给出建议。\n\nTITLE: ${file.basename}\n\nCONTENT:\n${content.slice(0, 20000)}`;
    await this.activateChatView();
    const view = this.getChatView();
    if (view) {
      view.setPendingInput(prompt);
    } else {
      new Notice('无法打开聊天视图');
    }
  }

  private getChatView(): ChatView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    return leaves.length > 0 ? (leaves[0].view as unknown as ChatView) : null;
  }

  async activateChatView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) as WorkspaceLeaf;
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
      }
    }
    if (leaf) {
      await workspace.revealLeaf(leaf);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<DshSettings>);
    // Migration: v0.1.0 wrongly injected DSH_TOOLS_MODE=workspace-write (a
    // file-sandbox value into a tool-backend knob, breaking profile boot).
    // Drop the legacy field so it can never be read again.
    const legacy = this.settings as unknown as { toolsMode?: string };
    if (legacy.toolsMode !== undefined) {
      delete legacy.toolsMode;
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
