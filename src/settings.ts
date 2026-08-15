import { App, PluginSettingTab, Setting } from 'obsidian';
import type DshPlugin from './main';
import { t, Locale, resolveLocale } from './i18n';
import { DshRunner } from './dsh-runner';

export interface DshSettings {
  dshBin: string;
  nodeBin: string;
  dshHome: string;
  workdir: string;
  timeoutSec: number;
  memoryEnabled: boolean;
  language: 'auto' | Locale;
  customPersona: string;
  /** Tool execution backend: '' (default native) | 'native' | 'code' | 'both'. */
  toolExecutionMode: string;
  /** DeepSeek model id: deepseek-v4-flash | deepseek-v4-pro. */
  model: string;
  /** Reasoning effort: off | high | max. */
  reasoningEffort: string;
  /** DSH sandbox mode: read-only | workspace-write | danger-full-access. */
  permissionMode: string;
  /** Show the thinking (reasoning) block in the chat. */
  showThinking: boolean;
  /** Show tool call blocks in the chat. */
  showTools: boolean;
  /** Max history entries kept (10-200). */
  historyLimit: number;
}

export const DEFAULT_SETTINGS: DshSettings = {
  dshBin: '',
  nodeBin: '',
  dshHome: '~/.dsh',
  workdir: '',
  timeoutSec: 600,
  memoryEnabled: true,
  language: 'auto',
  customPersona: '',
  toolExecutionMode: '',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'high',
  permissionMode: 'workspace-write',
  showThinking: true,
  showTools: true,
  historyLimit: 50,
};

export const MODEL_OPTIONS = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
] as const;

/** Context window (tokens) per model id. */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
};

/** Resolve the context window for a model id (safe default). */
export function contextWindowFor(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 1_000_000;
}

export const REASONING_OPTIONS = [
  { id: 'off', label: 'Off' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
] as const;

export const PERMISSION_OPTIONS = [
  { id: 'read-only', label: '只读' },
  { id: 'workspace-write', label: '工作区写入' },
  { id: 'danger-full-access', label: '完全访问' },
] as const;

export class DshSettingTab extends PluginSettingTab {
  plugin: DshPlugin;

  constructor(app: App, plugin: DshPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h3', { text: 'DeepHarness' });
    containerEl.createEl('p', {
      text: '类 Claudian 的 AI 助手 · 由 DeepSeek Harness 驱动,运行在 Obsidian vault 中。请先确保本机已安装 dsh 并配置好模型凭据。',
      cls: 'setting-item-description',
    });

    // Language
    new Setting(containerEl)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dd) => {
        dd.addOption('auto', 'Auto');
        dd.addOption('en', 'English');
        dd.addOption('zh', '中文');
        dd.setValue(this.plugin.settings.language).onChange(async (value) => {
          this.plugin.settings.language = value as DshSettings['language'];
          await this.plugin.saveSettings();
          this.plugin.applyLocale();
          this.display();
        });
      });

    // dsh binary
    new Setting(containerEl)
      .setName(t('settings.dshBin.name'))
      .setDesc(t('settings.dshBin.desc'))
      .addText((text) => text
        .setPlaceholder(t('settings.dshBin.placeholder'))
        .setValue(this.plugin.settings.dshBin)
        .onChange(async (value) => {
          this.plugin.settings.dshBin = value;
          await this.plugin.saveSettings();
        }));

    // node binary
    new Setting(containerEl)
      .setName(t('settings.nodeBin.name'))
      .setDesc(t('settings.nodeBin.desc'))
      .addText((text) => text
        .setPlaceholder(t('settings.nodeBin.placeholder'))
        .setValue(this.plugin.settings.nodeBin)
        .onChange(async (value) => {
          this.plugin.settings.nodeBin = value;
          await this.plugin.saveSettings();
        }));

    // DSH_HOME
    new Setting(containerEl)
      .setName(t('settings.dshHome.name'))
      .setDesc(t('settings.dshHome.desc'))
      .addText((text) => text
        .setPlaceholder(t('settings.dshHome.placeholder'))
        .setValue(this.plugin.settings.dshHome)
        .onChange(async (value) => {
          this.plugin.settings.dshHome = value;
          await this.plugin.saveSettings();
        }));

    // Workdir
    new Setting(containerEl)
      .setName(t('settings.workdir.name'))
      .setDesc(t('settings.workdir.desc'))
      .addText((text) => text
        .setPlaceholder(t('settings.workdir.placeholder'))
        .setValue(this.plugin.settings.workdir)
        .onChange(async (value) => {
          this.plugin.settings.workdir = value;
          await this.plugin.saveSettings();
        }));

    // Timeout
    new Setting(containerEl)
      .setName(t('settings.timeout.name'))
      .setDesc(t('settings.timeout.desc'))
      .addSlider((slider) => slider
        .setLimits(30, 1800, 30)
        .setValue(this.plugin.settings.timeoutSec)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.timeoutSec = value;
          await this.plugin.saveSettings();
        }));

    // Conversation memory
    new Setting(containerEl)
      .setName(t('settings.memory.name'))
      .setDesc(t('settings.memory.desc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.memoryEnabled)
        .onChange(async (value) => {
          this.plugin.settings.memoryEnabled = value;
          await this.plugin.saveSettings();
        }));

    // Tool execution mode
    new Setting(containerEl)
      .setName(t('settings.toolMode.name'))
      .setDesc(t('settings.toolMode.desc'))
      .addDropdown((dd) => {
        dd.addOption('', '默认 (native)');
        dd.addOption('native', 'native');
        dd.addOption('code', 'code');
        dd.addOption('both', 'both');
        dd.setValue(this.plugin.settings.toolExecutionMode).onChange(async (value) => {
          this.plugin.settings.toolExecutionMode = value;
          await this.plugin.saveSettings();
        });
      });

    // Model (also switchable from the chat header)
    new Setting(containerEl)
      .setName(t('settings.model.name'))
      .setDesc(t('settings.model.desc'))
      .addDropdown((dd) => {
        for (const m of MODEL_OPTIONS) dd.addOption(m.id, m.label);
        dd.setValue(this.plugin.settings.model).onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        });
      });

    // Reasoning effort (also switchable from the chat header)
    new Setting(containerEl)
      .setName(t('settings.reasoning.name'))
      .setDesc(t('settings.reasoning.desc'))
      .addDropdown((dd) => {
        for (const r of REASONING_OPTIONS) dd.addOption(r.id, r.label);
        dd.setValue(this.plugin.settings.reasoningEffort).onChange(async (value) => {
          this.plugin.settings.reasoningEffort = value;
          await this.plugin.saveSettings();
        });
      });

    // Permission / sandbox mode (also switchable from the chat header)
    new Setting(containerEl)
      .setName(t('settings.permission.name'))
      .setDesc(t('settings.permission.desc'))
      .addDropdown((dd) => {
        for (const p of PERMISSION_OPTIONS) dd.addOption(p.id, p.label);
        dd.setValue(this.plugin.settings.permissionMode).onChange(async (value) => {
          // Shared guard: switching into full access asks for confirmation
          // first; on cancel, revert the dropdown to the still-active mode.
          await this.plugin.setPermissionMode(value);
          dd.setValue(this.plugin.settings.permissionMode);
        });
      });

    // Show/hide thinking block
    new Setting(containerEl)
      .setName(t('settings.showThinking.name'))
      .setDesc(t('settings.showThinking.desc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showThinking)
        .onChange(async (value) => {
          this.plugin.settings.showThinking = value;
          await this.plugin.saveSettings();
        }));

    // Show/hide tool calls
    new Setting(containerEl)
      .setName(t('settings.showTools.name'))
      .setDesc(t('settings.showTools.desc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showTools)
        .onChange(async (value) => {
          this.plugin.settings.showTools = value;
          await this.plugin.saveSettings();
        }));

    // History limit
    new Setting(containerEl)
      .setName(t('settings.historyLimit.name'))
      .setDesc(t('settings.historyLimit.desc'))
      .addSlider((slider) => slider
        .setLimits(10, 200, 10)
        .setValue(this.plugin.settings.historyLimit)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.historyLimit = value;
          await this.plugin.saveSettings();
          this.plugin.history?.setLimit(value);
        }));

    // Custom persona
    new Setting(containerEl)
      .setName(t('settings.persona.name'))
      .setDesc(t('settings.persona.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder(t('settings.persona.placeholder'))
          .setValue(this.plugin.settings.customPersona)
          .onChange(async (value) => {
            this.plugin.settings.customPersona = value;
            await this.plugin.saveSettings();
            // Invalidate the generated patch so it regenerates with the new persona.
            this.plugin.invalidateVaultPatch();
          });
        text.inputEl.rows = 3;
      });

    containerEl.createEl('hr');

    // Environment check
    new Setting(containerEl)
      .setName(t('settings.check.title'))
      .setDesc(t('settings.check.help'))
      .addButton((button) => button
        .setButtonText(t('settings.check.run'))
        .onClick(async () => {
          const runner = new DshRunner(this.plugin.settings);
          const diag = await runner.diagnose();
          const line = containerEl.createEl('p', {
            cls: diag.found ? 'dsh-check-ok' : 'dsh-check-fail',
          });
          if (!diag.found) {
            line.setText(t('settings.check.missing'));
          } else {
            line.setText(t('settings.check.ok', { path: diag.bin }));
            if (diag.version) line.createEl('br');
            line.createSpan({ text: diag.version ?? diag.error ?? '' });
          }
          if (diag.nodeBin) {
            const nodeLine = containerEl.createEl('p', { cls: 'dsh-check-ok' });
            nodeLine.setText(`✓ Node.js: ${diag.nodeBin}`);
          } else {
            const nodeLine = containerEl.createEl('p', { cls: 'dsh-check-fail' });
            nodeLine.setText('✗ 未找到 Node.js,请在设置中填写 node 路径');
          }
        }));

    containerEl.createEl('hr');
    containerEl.createEl('p', {
      text: t('settings.footer'),
      cls: 'setting-item-description',
    });
  }
}

export function obsidianLocale(app: App): string {
  return (app as unknown as { i18n?: { language?: string } }).i18n?.language ?? 'en';
}
