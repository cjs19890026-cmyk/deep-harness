import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, setIcon, Modal, App, Setting, Menu, Component } from 'obsidian';
import type DshPlugin from './main';
import { DshClient } from './dsh-client';
import { DshRunner } from './dsh-runner';
import { MODEL_OPTIONS, REASONING_OPTIONS, PERMISSION_OPTIONS } from './settings';
import { ContextMeter, estimateTokens } from './context-meter';
import { HistoryTool } from './history';
import { t } from './i18n';

export const VIEW_TYPE_CHAT = 'dsh-obsidian-chat';

/** Compact timestamp for the narrow history panel. */
function formatShortTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`;
}

/** Rough fixed token cost of the vault persona system prompt (built-in rules). */
const PERSONA_FIXED_TOKENS = 250;

/**
 * Strip DLEVENT lines emitted by the injected stream-relay plugin from the
 * headless stdout. Those were already consumed live via onStdoutLine
 * (thinking + tool events); what remains is the agent's final answer.
 */
export function parseHeadlessOutput(stdout: string): string {
  const answerParts: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line.startsWith('DLEVENT\t')) continue;
    answerParts.push(line);
  }
  return answerParts.join('\n').trim();
}

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
  private clearBtn: HTMLButtonElement;
  private modelTrigger: HTMLButtonElement;
  private securityTrigger: HTMLButtonElement;
  private historyBtn: HTMLButtonElement;
  private historyPanel: HTMLElement | null = null;
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

    this.clearBtn = header.createEl('button', { cls: 'dsh-icon-btn' });
    setIcon(this.clearBtn, 'pen');
    this.clearBtn.setAttribute('aria-label', t('chat.clear'));
    this.clearBtn.onclick = () => this.clearChat();

    // Messages
    this.messagesContainer = container.createDiv({ cls: 'dsh-messages' });
    this.showWelcome();

    // Top toolbar (above the composer): history (right-aligned, minimal icon)
    const topToolbar = container.createDiv({ cls: 'dsh-top-toolbar' });
    this.historyBtn = topToolbar.createEl('button', { cls: 'dsh-top-btn dsh-top-history' });
    setIcon(this.historyBtn, 'clock');
    this.historyBtn.setAttribute('aria-label', '历史记录');
    this.historyBtn.onclick = () => this.toggleHistoryPanel();

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
    this.closeHistoryPanel();
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
    if (this.running) {
      new Notice(t('chat.busy'));
      return;
    }
    // Archive the current session into history, then start a new one.
    void this.plugin.history?.endSession();
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
    const patches = await this.runner.ensureVaultPatch(vaultRoot);
    const patchPaths = [patches.persona, patches.think].filter((p): p is string => p !== null);
    // Isolated DSH_HOME with the selected model + reasoning effort;
    // falls back to the user home when it cannot be prepared.
    const pluginHome = this.runner.ensurePluginDshHome(vaultRoot, {
      model: this.plugin.settings.model,
      effort: this.plugin.settings.reasoningEffort,
    });
    const dshHome = pluginHome ?? this.runner.dshHome();

    // Streaming assistant message: thinking + tools stream inline into the
    // message (web-UI style, no wrapper container), then the answer renders
    // below them in the same message. Both sections honor the settings
    // show-thinking / show-tools toggles.
    const respEl = this.createMessageElement('assistant');
    const contentEl = respEl.querySelector('.dsh-message-content') as HTMLElement;

    // Collapsible thinking block, live-filled (auto-collapsed on completion)
    let thinkBlock: HTMLElement | null = null;
    let thinkBody: HTMLElement | null = null;
    if (this.plugin.settings.showThinking) {
      thinkBlock = contentEl.createDiv({ cls: 'dsh-think' });
      const thinkToggle = thinkBlock.createEl('button', { cls: 'dsh-think-toggle' });
      const thinkChevron = thinkToggle.createSpan({ cls: 'dsh-think-chevron' });
      setIcon(thinkChevron, 'chevron-down');
      thinkToggle.createSpan({ text: '思考过程' });
      thinkBody = thinkBlock.createDiv({ cls: 'dsh-think-body' });
      thinkToggle.onclick = () => {
        const collapsed = thinkBody!.classList.contains('hidden');
        thinkBody!.classList.toggle('hidden', !collapsed);
        setIcon(thinkChevron, collapsed ? 'chevron-down' : 'chevron-right');
      };
    }

    // Tool calls stream directly into the message body (when enabled)
    const toolsWrap = this.plugin.settings.showTools
      ? contentEl.createDiv({ cls: 'dsh-stream-tools' })
      : null;

    const toolRows = new Map<string, {
      status: HTMLElement;
      chevron: HTMLElement;
      content: HTMLElement;
      name: string;
      args: string;
    }>();
    const toolsHistory: HistoryTool[] = [];
    let thinkingText = '';
    const handleStreamLine = (line: string): void => {
      if (!line.startsWith('DLEVENT\t')) return;
      let evt: { t?: string; text?: string; status?: string; id?: string; name?: string; args?: string; argsFull?: string; ok?: boolean; summary?: string };
      try {
        evt = JSON.parse(line.slice('DLEVENT\t'.length));
      } catch {
        return;
      }
      if (evt.t === 'think' && typeof evt.text === 'string') {
        thinkingText += evt.text;
        if (thinkBody) {
          thinkBody.setText(thinkingText.length > 4000 ? `…${thinkingText.slice(-4000)}` : thinkingText);
        }
        this.scrollToBottom();
      } else if (evt.t === 'tool' && evt.status) {
        if (!toolsWrap) return; // tool display disabled
        if (evt.status === 'start' && evt.id) {
          // One tool call block: clickable header + expanded content
          const call = toolsWrap.createDiv({ cls: 'dsh-tool-call' });
          const header = call.createEl('button', { cls: 'dsh-tool-header' });
          const icon = header.createSpan({ cls: 'dsh-tool-icon' });
          setIcon(icon, 'wrench');
          header.createSpan({ cls: 'dsh-tool-name', text: evt.name ?? 'tool' });
          header.createSpan({ cls: 'dsh-tool-summary', text: evt.args ?? '' });
          const status = header.createSpan({ cls: 'dsh-tool-status status-running' });
          setIcon(status, 'loader-circle');
          const chevron = header.createSpan({ cls: 'dsh-tool-chevron' });
          setIcon(chevron, 'chevron-right');
          const content = call.createDiv({ cls: 'dsh-tool-content hidden' });
          // Show the full arguments (the detailed command) right away
          if (evt.argsFull) {
            content.createDiv({ cls: 'dsh-tool-cmd', text: evt.argsFull });
          }
          header.onclick = () => {
            const collapsed = content.classList.contains('hidden');
            content.classList.toggle('hidden', !collapsed);
            setIcon(chevron, collapsed ? 'chevron-down' : 'chevron-right');
          };
          toolRows.set(evt.id, { status, chevron, content, name: evt.name ?? 'tool', args: evt.argsFull ?? evt.args ?? '' });
        } else if (evt.status === 'result') {
          const entry = evt.id ? toolRows.get(evt.id) : undefined;
          if (entry) {
            entry.status.classList.remove('status-running');
            if (evt.ok) {
              entry.status.classList.add('status-completed');
              setIcon(entry.status, 'check');
            } else {
              entry.status.classList.add('status-error');
              setIcon(entry.status, 'x');
            }
            const lineText = evt.summary
              ? evt.summary
              : evt.ok ? '(执行完成,无输出)' : '(执行失败)';
            // Tools stay collapsed by default; result visible when expanded.
            entry.content.createDiv({ cls: 'dsh-tool-line', text: lineText });
            // Collect for history
            toolsHistory.push({
              name: entry.name,
              args: entry.args,
              ok: evt.ok !== false,
              summary: evt.summary || undefined,
            });
          }
        }
        this.scrollToBottom();
      }
    };

    // Status line
    const statusEl = this.createStatusElement();
    this.startStatusTimer(statusEl);

    try {
      const result = await this.client.run(task, {
        dshBin: bin,
        nodeBin,
        dshScript,
        cwd: this.runner.workdir(vaultRoot),
        dshHome,
        toolsMode: this.plugin.settings.toolExecutionMode,
        permissionMode: this.plugin.settings.permissionMode,
        patchPath: patchPaths,
        timeoutMs: this.plugin.settings.timeoutSec * 1000,
        signal: this.abortController.signal,
        onStdoutLine: handleStreamLine,
      });

      this.stopStatusTimer();

      if (result.killed) {
        // Stopped by user: keep it subtle — a small status note only.
        statusEl.setText(`⏹ ${t('chat.cancelled')}`);
        this.finalizeStreamMessage(respEl, contentEl, thinkBlock, thinkBody, thinkingText, null);
      } else if (result.exitCode !== 0 || !result.stdout.trim()) {
        const errMsg = this.extractError(result.stderr);
        statusEl.setText(`✗ ${t('chat.failed', { message: errMsg })}`);
        statusEl.addClass('dsh-status-error');
        contentEl.createEl('span', { text: `> ❌ ${t('chat.failed', { message: errMsg })}`, cls: 'dsh-error-inline' });
        this.finalizeStreamMessage(respEl, contentEl, thinkBlock, thinkBody, thinkingText, null);
      } else {
        // The stream relay consumed DLEVENT lines live; the remaining stdout
        // is the final answer.
        const answer = parseHeadlessOutput(result.stdout);
        statusEl.setText(`✓ ${t('chat.completed', { duration: String(Math.round(result.durationMs / 1000)) })}`);
        this.finalizeStreamMessage(respEl, contentEl, thinkBlock, thinkBody, thinkingText, answer);
        // Remember this turn for the next task
        this.memory.push({
          user: message,
          assistant: answer.split('\n')[0].slice(0, 200),
        });
        if (this.memory.length > 20) this.memory.shift();
        // Persist this turn into the current session
        void this.plugin.history?.addTurn({
          ts: Date.now(),
          user: message,
          answer,
          thinking: thinkingText || undefined,
          tools: toolsHistory.length > 0 ? toolsHistory : undefined,
          durationMs: result.durationMs,
        }, {
          model: this.plugin.settings.model,
          effort: this.plugin.settings.reasoningEffort,
          permission: this.plugin.settings.permissionMode,
        });
      }
    } catch (e) {
      this.stopStatusTimer();
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.setText(`✗ ${t('chat.failed', { message: msg })}`);
      statusEl.addClass('dsh-status-error');
      contentEl.createEl('span', { text: `> ❌ ${t('chat.failed', { message: msg })}`, cls: 'dsh-error-inline' });
      this.finalizeStreamMessage(respEl, contentEl, thinkBlock, thinkBody, thinkingText, null);
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
    this.clearBtn.disabled = true;
  }

  private resetButtonToSend(): void {
    this.sendButton.setText(t('chat.send'));
    this.sendButton.removeClass('is-stop');
    this.clearBtn.disabled = false;
  }

  /** Create a message wrapper element (used by streaming send). */
  private createMessageElement(role: 'user' | 'assistant'): HTMLElement {
    const el = this.messagesContainer.createDiv({
      cls: `dsh-message dsh-message-${role}`,
    });
    el.createDiv({ cls: 'dsh-message-content' });
    return el;
  }

  private renderMessage(
    role: 'user' | 'assistant',
    content: string,
    isSystem = false,
    thinking?: string | null,
    tools?: HistoryTool[],
  ): void {
    const el = this.messagesContainer.createDiv({
      cls: `dsh-message dsh-message-${role}${isSystem ? ' dsh-message-system' : ''}`,
    });
    const contentEl = el.createDiv({ cls: 'dsh-message-content' });
    if (role === 'assistant') {
      // Collapsible thinking block (shown before the answer)
      if (thinking) {
        this.renderThinkingBlock(contentEl, thinking);
      }
      if (tools && tools.length > 0) {
        this.renderToolsBlock(contentEl, tools);
      }
      void MarkdownRenderer.render(this.app, content, contentEl, '', this);
      if (!isSystem) this.addMessageActions(el, content);
    } else {
      contentEl.setText(content);
    }
    this.scrollToBottom();
  }

  /** Collapsible "思考过程" block (default collapsed, plain text). */
  private renderThinkingBlock(container: HTMLElement, thinking: string): void {
    const block = container.createDiv({ cls: 'dsh-think' });
    const toggle = block.createEl('button', { cls: 'dsh-think-toggle' });
    const chevron = toggle.createSpan({ cls: 'dsh-think-chevron' });
    setIcon(chevron, 'chevron-right');
    toggle.createSpan({ text: '思考过程' });
    const body = block.createDiv({ cls: 'dsh-think-body hidden' });
    body.setText(thinking);
    toggle.onclick = () => {
      const collapsed = body.hasClass('hidden');
      body.toggleClass('hidden', !collapsed);
      if (collapsed) setIcon(chevron, 'chevron-down');
      else setIcon(chevron, 'chevron-right');
    };
  }

  /** Collapsed "工具调用" block for restored history turns. */
  private renderToolsBlock(container: HTMLElement, tools: HistoryTool[]): void {
    const wrap = container.createDiv({ cls: 'dsh-stream-tools' });
    for (const tool of tools) {
      const call = wrap.createDiv({ cls: 'dsh-tool-call' });
      const header = call.createEl('button', { cls: 'dsh-tool-header' });
      const icon = header.createSpan({ cls: 'dsh-tool-icon' });
      setIcon(icon, 'wrench');
      header.createSpan({ cls: 'dsh-tool-name', text: tool.name });
      if (tool.args) header.createSpan({ cls: 'dsh-tool-summary', text: tool.args });
      const status = header.createSpan({ cls: 'dsh-tool-status' });
      if (tool.ok) {
        status.addClass('status-completed');
        setIcon(status, 'check');
      } else {
        status.addClass('status-error');
        setIcon(status, 'x');
      }
      const chevron = header.createSpan({ cls: 'dsh-tool-chevron' });
      setIcon(chevron, 'chevron-right');
      const content = call.createDiv({ cls: 'dsh-tool-content hidden' });
      if (tool.args) content.createDiv({ cls: 'dsh-tool-cmd', text: tool.args });
      const lineText = tool.summary
        ? tool.summary
        : tool.ok ? '(执行完成,无输出)' : '(执行失败)';
      content.createDiv({ cls: 'dsh-tool-line', text: lineText });
      header.onclick = () => {
        const collapsed = content.hasClass('hidden');
        content.toggleClass('hidden', !collapsed);
        if (collapsed) setIcon(chevron, 'chevron-down');
        else setIcon(chevron, 'chevron-right');
      };
    }
  }

  /** Finalize the streaming message: collapse thinking, render the answer. */
  private finalizeStreamMessage(
    respEl: HTMLElement,
    contentEl: HTMLElement,
    thinkBlock: HTMLElement | null,
    thinkBody: HTMLElement | null,
    thinkingText: string,
    answer: string | null,
  ): void {
    if (thinkBlock && thinkBody) {
      if (thinkingText && thinkingText.trim()) {
        thinkBody.setText(thinkingText);
        // Thinking is live-expanded while running, then auto-collapsed once
        // the answer is complete (user can re-expand it).
        thinkBody.classList.add('hidden');
        const chevron = thinkBlock.querySelector('.dsh-think-chevron') as HTMLElement | null;
        if (chevron) setIcon(chevron, 'chevron-right');
      } else {
        thinkBlock.remove();
      }
    }
    if (answer) {
      void MarkdownRenderer.render(this.app, answer, contentEl, '', this);
      this.addMessageActions(respEl, answer);
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

  /** Resume an archived session: re-activate it so new turns append back. */
  private async resumeSession(s: import('./history').SessionRecord): Promise<void> {
    const activated = await this.plugin.history?.activateSession(s.id);
    if (!activated) {
      new Notice('恢复会话失败');
      return;
    }
    // Rebuild context memory from the most recent turns (used for refill).
    this.memory = activated.turns.slice(-20).map((t) => ({
      user: t.user,
      assistant: t.answer.split('\n')[0].slice(0, 200),
    }));
    // Restore the transcript so the conversation is visible again.
    this.messagesContainer.empty();
    for (const t of activated.turns) {
      this.renderMessage('user', t.user);
      this.renderMessage('assistant', t.answer, false, t.thinking, t.tools);
    }
    this.contextMeter?.reset();
    this.scrollToBottom();
    new Notice(`已恢复会话:${activated.title}`);
  }

  // ── History panel (floating, anchored to the toolbar icon) ─────────

  private toggleHistoryPanel(): void {
    if (this.historyPanel) {
      this.closeHistoryPanel();
      return;
    }
    this.openHistoryPanel();
  }

  private openHistoryPanel(): void {
    this.closeHistoryPanel();
    const panel = createDiv({ cls: 'dsh-history-panel' });
    this.historyPanel = panel;

    const sessions = this.plugin.history?.getSessions() ?? [];
    if (sessions.length === 0) {
      panel.createDiv({ cls: 'dsh-history-empty', text: '暂无会话' });
    } else {
      for (const s of sessions) {
        const item = panel.createDiv({
          cls: `dsh-history-panel-item${s.pinned ? ' is-pinned' : ''}`,
        });

        // Row 1: bubble icon + title + (rename / pin / delete) icons
        const row1 = item.createDiv({ cls: 'dsh-history-row1' });
        const bubble = row1.createSpan({ cls: 'dsh-history-bubble' });
        setIcon(bubble, 'message-circle');
        const title = row1.createSpan({ cls: 'dsh-history-panel-title', text: s.title });

        const renameBtn = row1.createEl('button', { cls: 'dsh-history-act' });
        setIcon(renameBtn, 'pencil');
        renameBtn.setAttribute('aria-label', '重命名');
        renameBtn.onclick = (e) => {
          e.stopPropagation();
          this.renameInPanel(item, title, s);
        };

        const pinBtn = row1.createEl('button', { cls: `dsh-history-act${s.pinned ? ' is-active' : ''}` });
        setIcon(pinBtn, 'pin');
        pinBtn.setAttribute('aria-label', s.pinned ? '取消固定' : '固定到顶部');
        pinBtn.onclick = (e) => {
          e.stopPropagation();
          void this.plugin.history?.togglePin(s.id).then(() => this.openHistoryPanel());
        };

        const delBtn = row1.createEl('button', { cls: 'dsh-history-act' });
        setIcon(delBtn, 'x');
        delBtn.setAttribute('aria-label', '删除会话');
        delBtn.onclick = (e) => {
          e.stopPropagation();
          void this.plugin.history?.removeSession(s.id).then(() => this.openHistoryPanel());
        };

        // Row 2: date + editable note
        const row2 = item.createDiv({ cls: 'dsh-history-row2' });
        row2.createSpan({ cls: 'dsh-history-date', text: new Date(s.endedAt).toLocaleString() });
        const note = row2.createSpan({ cls: 'dsh-history-note', text: s.note || '添加备注…' });
        note.onclick = (e) => {
          e.stopPropagation();
          this.editNoteInPanel(note, s);
        };

        // Click the item anywhere (not on a button) → resume the session
        item.onclick = () => {
          this.closeHistoryPanel();
          this.resumeSession(s);
        };
      }
    }

    document.body.appendChild(panel);

    // Anchor: the panel's bottom-right corner sits against the icon.
    const rect = this.historyBtn.getBoundingClientRect();
    panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;

    setTimeout(() => {
      document.addEventListener('mousedown', this.onHistoryOutside);
    }, 0);
    document.addEventListener('keydown', this.onHistoryKeydown);
  }

  /** Inline rename of a session title inside the panel. */
  private renameInPanel(item: HTMLElement, titleEl: HTMLElement, s: import('./history').SessionRecord): void {
    const input = createEl('input', { cls: 'dsh-history-rename-input' });
    input.value = s.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = (): void => {
      const v = input.value.trim();
      if (v) void this.plugin.history?.renameSession(s.id, v);
      this.openHistoryPanel();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { this.openHistoryPanel(); }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  /** Inline note editing inside the panel. */
  private editNoteInPanel(noteEl: HTMLElement, s: import('./history').SessionRecord): void {
    const input = createEl('input', { cls: 'dsh-history-note-input' });
    input.value = s.note || '';
    input.placeholder = '添加备注…';
    noteEl.replaceWith(input);
    input.focus();
    const commit = (): void => {
      void this.plugin.history?.setNote(s.id, input.value);
      this.openHistoryPanel();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { this.openHistoryPanel(); }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  private closeHistoryPanel(): void {
    if (this.historyPanel) {
      this.historyPanel.remove();
      this.historyPanel = null;
    }
    document.removeEventListener('mousedown', this.onHistoryOutside);
    document.removeEventListener('keydown', this.onHistoryKeydown);
  }

  private onHistoryOutside = (e: MouseEvent): void => {
    if (this.historyPanel && !this.historyPanel.contains(e.target as Node)) {
      this.closeHistoryPanel();
    }
  };

  private onHistoryKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.closeHistoryPanel();
    }
  };
}
