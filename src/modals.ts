import { Modal, App, Setting, Notice } from 'obsidian';
import { t } from './i18n';

/** Simplified "save as note" modal (pattern borrowed from claudian). */
export class NoteCreatorModal extends Modal {
  private title = '';
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
