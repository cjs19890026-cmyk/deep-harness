import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, setIcon, Modal, App, Setting, Menu } from 'obsidian';
import type DshPlugin from './main';
import { DshClient } from './dsh-client';
import { DshRunner } from './dsh-runner';
import { MODEL_OPTIONS, REASONING_OPTIONS, PERMISSION_OPTIONS } from './settings';
import { ContextMeter, estimateTokens } from './context-meter';
import { t } from './i18n';

export const VIEW_TYPE_CHAT = 'dsh-obsidian-chat';

/** Rough fixed token cost of the vault persona system prompt (built-in rules). */
const PERSONA_FIXED_TOKENS = 250;

interface MemoryTurn {
  user: string;
  assistant: string;
}

/** Simplified "save as note" modal (pattern borrowed from claudian). */
export class NoteCreatorModal extends Modal {  private title = '';
  private content: string;

  constructor(app: App, content: string, private folder: string) {
    super(app);
    this.content = content;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    new Setting(contentEl)
      .setName(t('chat.saveNoteTitle'))
      .addText((text) => text
        .setPlaceholder(t('chat.saveNotePrompt'))
        .onChange((v) => { this.title = v.trim(); }))
      .addButton((button) => button
        .setButtonText(t('chat.saveNote'))
        .setCta()
        .onClick(async () => {
          const name = this.title || `Harness-${Date.now()}`;
          const path = this.folder
            ? `${this.folder.replace(/\/$/, '')}/${name}.md`
            : `${name}.md`;
          try {
            await this.app.vault.create(path, this.content);
            new Notice(t('chat.saved'));
            this.close();
          } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e));
          }
        }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Confirmation dialog when switching to danger-full-access. */
export class SecurityConfirmModal extends Modal {
  constructor(
    app: App,
    private onConfirm: () => void,
    private onCancel: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: t('security.confirmTitle') });
    contentEl.createEl('p', { text: t('security.confirmDesc') });
    const btns = contentEl.createDiv({ cls: 'dsh-modal-buttons' });
    const ok = btns.createEl('button', { cls: 'mod-cta', text: t('security.confirmOk') });
    ok.onclick = () => {
      this.onConfirm();
      this.close();
    };
    const cancel = btns.createEl('button', { text: t('security.cancel') });
    cancel.onclick = () => {
      this.onCancel();
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ChatView extends ItemView {
  plugin: DshPlugin;
  private client: DshClient;
  private runner: DshRunner;

  private messagesContainer: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private modelTrigger: HTMLButtonElement;
  private securityTrigger: HTMLButtonElement;
  private statusEl: HTMLElement | null = null;
  private statusTimer: number | null = null;
  private statusStartedAt = 0;
  private abortController: AbortController | null = null;
  private running = false;
  private memory: MemoryTurn[] = [];
  private contextMeter: ContextMeter | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: DshPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.client = new DshClient();
    this.runner = new DshRunner(plugin.settings);
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return 'Harness Chat';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('dsh-container');

    // Ensure cursor text selection works everywhere in the chat UI
    // (Obsidian views default to non-selectable; inline style beats themes).
    container.style.setProperty('user-select', 'text');
    container.style.setProperty('-webkit-user-select', 'text');

    // Header
    const header = container.createDiv({ cls: 'dsh-header' });
    const title = header.createDiv({ cls: 'dsh-header-title' });
    title.createEl('h4', { text: 'Harness Chat' });
    title.createSpan({ cls: 'dsh-header-sub', text: 'DeepSeek Harness' });

    const clearBtn = header.createEl('button', { cls: 'dsh-icon-btn' });
    setIcon(clearBtn, 'trash-2');
    clearBtn.setAttribute('aria-label', t('chat.clear'));
    clearBtn.onclick = () => this.clearChat();

    // Messages
    this.messagesContainer = container.createDiv({ cls: 'dsh-messages' });
    this.showWelcome();

    // Composer card: textarea + toolbar (model/effort/security/meter/send)
    const composer = container.createDiv({ cls: 'dsh-composer' });

    this.inputEl = composer.createEl('textarea', {
      cls: 'dsh-input',
      attr: { placeholder: t('chat.placeholder'), rows: '2' },
    });
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.sendMessage();
      }
    });
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + 'px';
    });

    const toolbar = composer.createDiv({ cls: 'dsh-composer-toolbar' });

    // Model + reasoning trigger button (single line: name · effort)
    this.modelTrigger = toolbar.createEl('button', { cls: 'dsh-trigger dsh-trigger-model' });
    this.modelTrigger.createSpan({ cls: 'dsh-trigger-model-name' });
    this.modelTrigger.createSpan({ cls: 'dsh-trigger-effort' });
    this.modelTrigger.onclick = (e) => this.showModelMenu(e);

    // Security trigger button
    this.securityTrigger = toolbar.createEl('button', { cls: 'dsh-trigger dsh-trigger-security' });
    this.securityTrigger.createSpan({ cls: 'dsh-trigger-security-icon' });
    setIcon(this.securityTrigger.querySelector('.dsh-trigger-security-icon') as HTMLElement, 'shield');
    this.securityTrigger.createSpan({ cls: 'dsh-trigger-security-label' });
    this.securityTrigger.onclick = (e) => this.showSecurityMenu(e);

    // Context usage ring
    this.contextMeter = new ContextMeter(toolbar);

    // Send button (capsule)
    this.sendButton = toolbar.createEl('button', { cls: 'dsh-send-btn', text: t('chat.send') });
    this.sendButton.onclick = () => {
      if (this.running) {
        this.stopRun();
      } else {
        void this.sendMessage();
      }
    };

    this.updateTriggerLabels();
  }

  /** Refresh trigger button labels from settings. */
  private updateTriggerLabels(): void {
    if (!this.modelTrigger || !this.securityTrigger) return;
    const m = MODEL_OPTIONS.find((x) => x.id === this.plugin.settings.model);
    const r = REASONING_OPTIONS.find((x) => x.id === this.plugin.settings.reasoningEffort);
    const nameEl = this.modelTrigger.querySelector('.dsh-trigger-model-name') as HTMLElement;
    const effortEl = this.modelTrigger.querySelector('.dsh-trigger-effort') as HTMLElement;
    if (nameEl) nameEl.textContent = m ? m.label : this.plugin.settings.model;
    if (effortEl) effortEl.textContent = `· ${r ? r.label : this.plugin.settings.reasoningEffort}`;
    const secLabel = this.securityTrigger.querySelector('.dsh-trigger-security-label') as HTMLElement;
    const p = PERMISSION_OPTIONS.find((x) => x.id === this.plugin.settings.permissionMode);
    if (secLabel) secLabel.textContent = p ? p.label : this.plugin.settings.permissionMode;
    this.securityTrigger.toggleClass(
      'dsh-trigger-danger',
      this.plugin.settings.permissionMode === 'danger-full-access',
    );
  }

  /** Model + reasoning effort menu (two sections in one popup). */
  private showModelMenu(evt: MouseEvent): void {
    const menu = new Menu();
    for (const m of MODEL_OPTIONS) {
      menu.addItem((item) => item
        .setTitle(m.label)
        .setChecked(m.id === this.plugin.settings.model)
        .onClick(() => {
          this.plugin.settings.model = m.id;
          void this.plugin.saveSettings();
          this.updateTriggerLabels();
        }));
    }
    menu.addSeparator();
    for (const r of REASONING_OPTIONS) {
      menu.addItem((item) => item
        .setTitle(r.label)
        .setChecked(r.id === this.plugin.settings.reasoningEffort)
        .onClick(() => {
          this.plugin.settings.reasoningEffort = r.id;
          void this.plugin.saveSettings();
          this.updateTriggerLabels();
        }));
    }
    menu.showAtMouseEvent(evt);
  }

  /** Security / sandbox mode menu. */
  private showSecurityMenu(evt: MouseEvent): void {
    const menu = new Menu();
    for (const p of PERMISSION_OPTIONS) {
      menu.addItem((item) => item
        .setTitle(p.label)
        .setChecked(p.id === this.plugin.settings.permissionMode)
        .onClick(() => this.applyPermissionMode(p.id)));
    }
    menu.showAtMouseEvent(evt);
  }

  private applyPermissionMode(mode: string): void {
    const switchingToFull = mode === 'danger-full-access'
      && this.plugin.settings.permissionMode !== 'danger-full-access';
    if (switchingToFull) {
      new SecurityConfirmModal(
        this.app,
        () => {
          this.plugin.settings.permissionMode = mode;
          void this.plugin.saveSettings();
          this.updateTriggerLabels();
        },
        () => {
          this.updateTriggerLabels();
        },
      ).open();
    } else {
      this.plugin.settings.permissionMode = mode;
      void this.plugin.saveSettings();
      this.updateTriggerLabels();
    }
  }

  onClose(): Promise<void> {
    this.client.dispose();
    if (this.statusTimer !== null) window.clearInterval(this.statusTimer);
    return Promise.resolve();
  }

  private showWelcome(): void {
    const w = this.messagesContainer.createDiv({ cls: 'dsh-welcome' });
    w.createEl('h2', { text: 'Harness Chat' });
    w.createEl('p', {
      text: '直接把任务交给 DeepSeek Harness:它会用 bash、文件工具、web 搜索等能力在你的 vault 里工作。',
    });
    const examples = [
      '把 Projects 文件夹里所有 #todo 笔记汇总成一份周报',
      '用 web 搜索最近的 DeepSeek 新闻,写一篇 3 段摘要存为笔记',
      '给当前 vault 生成一份目录结构说明',
    ];
    const list = w.createEl('ul', { cls: 'dsh-welcome-examples' });
    for (const ex of examples) {
      const li = list.createEl('li', { text: ex });
      li.onclick = () => {
        this.inputEl.value = ex;
        this.inputEl.focus();
      };
    }
  }

  private clearChat(): void {
    this.memory = [];
    this.contextMeter?.reset();
    this.messagesContainer.empty();
    this.showWelcome();
    new Notice(t('chat.cleared'));
  }

  private async sendMessage(): Promise<void> {
    const message = this.inputEl.value.trim();
    if (!message || this.running) {
      if (this.running) new Notice(t('chat.busy'));
      return;
    }

    const bin = await this.runner.detectBin();
    if (!bin) {
      this.renderMessage('assistant', `> ⚠️ ${t('chat.noDsh')}`, true);
      new Notice(t('chat.noDsh'), 6000);
      return;
    }
    // Detect node + dsh's real script so we spawn `node bin.js` directly
    // (bypasses the shebang, which fails under Electron's restricted PATH).
    const nodeBin = await this.runner.detectNode();
    const dshScript = this.runner.resolveDshScript(bin);
    if (!nodeBin || !dshScript) {
      const msg = `> ⚠️ 未找到 Node.js 或 dsh 脚本路径(node: ${nodeBin ?? '?'} / script: ${dshScript ?? '?'}),请在插件设置中填写 Node.js 路径。`;
      this.renderMessage('assistant', msg, true);
      new Notice('未找到 Node.js 或 dsh 脚本路径', 6000);
      return;
    }

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.renderMessage('user', message);

    this.running = true;
    this.abortController = new AbortController();
    this.setButtonToStop();

    const vaultRoot = this.plugin.getVaultRoot();
    const memorySummary = this.buildMemorySummary();
    const task = this.runner.buildTask(message, memorySummary);
    // Context meter: account for this turn's prompt (system persona +
    // assembled task) right when it is sent.
    if (this.contextMeter) {
      this.contextMeter.addTokens(PERSONA_FIXED_TOKENS + estimateTokens(task));
    }
    const patchPath = await this.runner.ensureVaultPatch(vaultRoot);
    // Isolated DSH_HOME with the selected model + reasoning effort;
    // falls back to the user home when it cannot be prepared.
    const pluginHome = this.runner.ensurePluginDshHome(vaultRoot, {
      model: this.plugin.settings.model,
      effort: this.plugin.settings.reasoningEffort,
    });
    const dshHome = pluginHome ?? this.runner.dshHome();

    // Status line
    const statusEl = this.createStatusElement();
    this.startStatusTimer(statusEl);

    let fullAnswer = '';
    try {
      const result = await this.client.run(task, {
        dshBin: bin,
        nodeBin,
        dshScript,
        cwd: this.runner.workdir(vaultRoot),
        dshHome,
        toolsMode: this.plugin.settings.toolExecutionMode,
        permissionMode: this.plugin.settings.permissionMode,
        patchPath: patchPath ?? undefined,
        timeoutMs: this.plugin.settings.timeoutSec * 1000,
        signal: this.abortController.signal,
      });

      this.stopStatusTimer();
      fullAnswer = result.stdout.trim();

      if (result.killed) {
        // Stopped by user: keep it subtle — a small status note only,
        // no full-width red message in the transcript.
        statusEl.setText(`⏹ ${t('chat.cancelled')}`);
      } else if (result.exitCode !== 0 || !fullAnswer) {
        const errMsg = this.extractError(result.stderr);
        statusEl.setText(`✗ ${t('chat.failed', { message: errMsg })}`);
        statusEl.addClass('dsh-status-error');
        this.renderMessage('assistant', `> ❌ ${t('chat.failed', { message: errMsg })}`, true);
      } else {
        statusEl.setText(`✓ ${t('chat.completed', { duration: String(Math.round(result.durationMs / 1000)) })}`);
        this.renderMessage('assistant', fullAnswer, false);
        // Remember this turn for the next task
        this.memory.push({
          user: message,
          assistant: fullAnswer.split('\n')[0].slice(0, 200),
        });
        if (this.memory.length > 20) this.memory.shift();
      }
    } catch (e) {
      this.stopStatusTimer();
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.setText(`✗ ${t('chat.failed', { message: msg })}`);
      statusEl.addClass('dsh-status-error');
      this.renderMessage('assistant', `> ❌ ${t('chat.failed', { message: msg })}`, true);
    } finally {
      this.running = false;
      this.abortController = null;
      this.resetButtonToSend();
      this.scrollToBottom();
    }
  }

  private stopRun(): void {
    this.abortController?.abort();
    this.client.stop();
  }

  /** Summarize recent turns into compact bullet lines for context refill. */
  private buildMemorySummary(): string[] {
    if (this.memory.length === 0) return [];
    const recent = this.memory.slice(-8);
    const lines = ['[对话记忆]'];
    for (const turn of recent) {
      lines.push(`- 用户: ${turn.user.slice(0, 120)}`);
      if (turn.assistant) lines.push(`  助手: ${turn.assistant.slice(0, 120)}`);
    }
    return [lines.join('\n')];
  }

  /** Parse a dsh stderr line: `dsh: CODE: message`. */
  private extractError(stderr: string): string {
    const m = stderr.match(/dsh:\s*(?:[A-Z_]+:\s*)?(.+)/s);
    const raw = m ? m[1].trim() : stderr.trim();
    return raw || 'unknown error';
  }

  private createStatusElement(): HTMLElement {
    this.statusEl = this.messagesContainer.createDiv({ cls: 'dsh-status' });
    this.statusEl.setText(`${t('chat.starting')} …`);
    this.scrollToBottom();
    return this.statusEl;
  }

  private startStatusTimer(statusEl: HTMLElement): void {
    this.statusStartedAt = Date.now();
    this.stopStatusTimer();
    const tick = (): void => {
      const sec = Math.round((Date.now() - this.statusStartedAt) / 1000);
      statusEl.setText(`⏳ ${t('chat.thinking')} ${sec}s`);
    };
    tick();
    this.statusTimer = window.setInterval(tick, 1000);
  }

  private stopStatusTimer(): void {
    if (this.statusTimer !== null) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  private setButtonToStop(): void {
    this.sendButton.setText(t('chat.stop'));
    this.sendButton.addClass('is-stop');
  }

  private resetButtonToSend(): void {
    this.sendButton.setText(t('chat.send'));
    this.sendButton.removeClass('is-stop');
  }

  private renderMessage(role: 'user' | 'assistant', content: string, isSystem = false): void {
    const el = this.messagesContainer.createDiv({
      cls: `dsh-message dsh-message-${role}${isSystem ? ' dsh-message-system' : ''}`,
    });
    const contentEl = el.createDiv({ cls: 'dsh-message-content' });
    if (role === 'assistant') {
      void MarkdownRenderer.render(this.app, content, contentEl, '', this);
      if (!isSystem) this.addMessageActions(el, content);
    } else {
      contentEl.setText(content);
    }
    this.scrollToBottom();
  }

  private addMessageActions(messageEl: HTMLElement, content: string): void {
    const actions = messageEl.createDiv({ cls: 'dsh-message-actions' });
    const copyBtn = actions.createEl('button', { cls: 'dsh-action-btn' });
    setIcon(copyBtn, 'clipboard-copy');
    copyBtn.setAttribute('aria-label', t('chat.copy'));
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(content);
      new Notice(t('chat.copied'));
    };
    const noteBtn = actions.createEl('button', { cls: 'dsh-action-btn' });
    setIcon(noteBtn, 'file-plus');
    noteBtn.setAttribute('aria-label', t('chat.saveNote'));
    noteBtn.onclick = () => {
      const folder = this.plugin.settings.workdir.trim();
      new NoteCreatorModal(this.app, content, folder).open();
    };
  }

  private scrollToBottom(): void {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  /** Prefill the input (used by the "ask about active note" command). */
  setPendingInput(text: string): void {
    this.inputEl.value = text;
    this.inputEl.focus();
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + 'px';
    this.scrollToBottom();
  }
}
