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
};

export const MODEL_OPTIONS = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
] as const;

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

    containerEl.createEl('h3', { text: 'DeepSeek Harness' });
    containerEl.createEl('p', {
      text: '这个插件通过 dsh CLI 调用 DeepSeek Harness。请先确保本机已安装 dsh 并配置好模型凭据。',
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
      .setName('Node.js 路径')
      .setDesc('留空则自动探测(Homebrew / nvm / volta)。Obsidian 的 PATH 不含 Homebrew 目录,插件会直接用 node 运行 dsh 脚本。')
      .addText((text) => text
        .setPlaceholder('/opt/homebrew/bin/node')
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
      .setName('工具执行模式 (DSH_TOOLS_MODE)')
      .setDesc('native(默认)= 原生函数调用;code = 通过 run_code 执行;both = 两者。留空使用 DSH 默认。')
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
      .setName('模型 (Model)')
      .setDesc('默认模型,可在聊天面板顶部快速切换。')
      .addDropdown((dd) => {
        for (const m of MODEL_OPTIONS) dd.addOption(m.id, m.label);
        dd.setValue(this.plugin.settings.model).onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        });
      });

    // Reasoning effort (also switchable from the chat header)
    new Setting(containerEl)
      .setName('推理等级 (Thinking)')
      .setDesc('off / high / max,可在聊天面板顶部快速切换。')
      .addDropdown((dd) => {
        for (const r of REASONING_OPTIONS) dd.addOption(r.id, r.label);
        dd.setValue(this.plugin.settings.reasoningEffort).onChange(async (value) => {
          this.plugin.settings.reasoningEffort = value;
          await this.plugin.saveSettings();
        });
      });

    // Permission / sandbox mode (also switchable from the chat header)
    new Setting(containerEl)
      .setName('安全模式 (Security)')
      .setDesc('只读 = 拒绝所有文件修改;工作区写入 = 文件工具限 vault 内;完全访问 = 等同终端权限(谨慎)。')
      .addDropdown((dd) => {
        for (const p of PERMISSION_OPTIONS) dd.addOption(p.id, p.label);
        dd.setValue(this.plugin.settings.permissionMode).onChange(async (value) => {
          this.plugin.settings.permissionMode = value;
          await this.plugin.saveSettings();
        });
      });

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
