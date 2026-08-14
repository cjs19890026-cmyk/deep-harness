import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { DshDiagnostics } from './dsh-client';
import type { DshSettings } from './settings';

const execFileAsync = promisify(execFile);

/**
 * Command construction and environment probing for the dsh CLI.
 *
 * - Detects the `dsh` binary (explicit setting > PATH > common locations).
 * - Detects a Node.js binary and dsh's real entry script so the plugin can
 *   spawn `node <dsh>/lib/bin.js` directly. Obsidian's Electron process runs
 *   with a restricted PATH (no Homebrew/nvm dirs), so relying on the `dsh`
 *   shebang (`#!/usr/bin/env node`) fails with "env: node: No such file or
 *   directory".
 * - Warms up the `headless` profile on first use (dsh bootstraps the
 *   profile directory under DSH_HOME on demand).
 * - Generates the vault persona `--patch` overlay once per vault.
 * - Assembles the task text: conversation memory + user message.
 */

const COMMON_BIN_CANDIDATES = [
  '/opt/homebrew/bin/dsh',
  '/usr/local/bin/dsh',
  '/usr/bin/dsh',
];

const COMMON_NODE_CANDIDATES = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/node',
];

export class DshRunner {
  constructor(private settings: DshSettings) {}

  /** Resolve the dsh binary path, or null when not found. */
  async detectBin(): Promise<string | null> {
    const explicit = this.settings.dshBin.trim();
    if (explicit) {
      if (await this.exists(explicit)) return explicit;
      return null;
    }
    // PATH lookup
    try {
      const { stdout } = await execFileAsync('which', ['dsh'], { timeout: 5000 });
      const p = stdout.trim();
      if (p) return p;
    } catch {
      // not in PATH
    }
    for (const candidate of COMMON_BIN_CANDIDATES) {
      if (await this.exists(candidate)) return candidate;
    }
    return null;
  }

  /** Probe binary + profile readiness for the settings page. */
  async diagnose(): Promise<DshDiagnostics> {
    const bin = await this.detectBin();
    const nodeBin = await this.detectNode();
    if (!bin) {
      return { bin: '', found: false, version: null, error: 'not-found', nodeBin };
    }
    try {
      const script = this.resolveDshScript(bin);
      const { stdout } = await execFileAsync(nodeBin ?? bin, (script ? [script] : []).concat(['--version']), {
        timeout: 10000,
        env: { ...process.env as Record<string, string>, DSH_HOME: this.dshHome() },
      });
      return { bin, found: true, version: stdout.trim(), error: null, nodeBin };
    } catch (e) {
      return { bin, found: true, version: null, error: e instanceof Error ? e.message : String(e), nodeBin };
    }
  }

  /**
   * Detect a usable Node.js binary.
   * Order: explicit setting > PATH > common install dirs > nvm/volta.
   */
  async detectNode(): Promise<string | null> {
    const explicit = this.settings.nodeBin.trim();
    if (explicit) {
      return (await this.exists(explicit)) ? explicit : null;
    }
    // PATH lookup (usually empty under Electron, but harmless to try)
    try {
      const { stdout } = await execFileAsync('which', ['node'], { timeout: 5000 });
      const p = stdout.trim();
      if (p && (await this.exists(p))) return p;
    } catch {
      // not in PATH
    }
    for (const candidate of COMMON_NODE_CANDIDATES) {
      if (await this.exists(candidate)) return candidate;
    }
    // nvm: ~/.nvm/versions/node/vX.Y.Z/bin/node — pick the newest
    try {
      const nvmRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
      const versions = fs.readdirSync(nvmRoot)
        .filter((v) => v.startsWith('v'))
        .sort()
        .reverse();
      for (const v of versions) {
        const p = path.join(nvmRoot, v, 'bin', 'node');
        if (await this.exists(p)) return p;
      }
    } catch {
      // no nvm
    }
    // volta
    const volta = path.join(os.homedir(), '.volta', 'bin', 'node');
    if (await this.exists(volta)) return volta;
    return null;
  }

  /**
   * Resolve the real entry script of the dsh CLI.
   * npm's global bin entries are symlinks (dsh -> ../lib/node_modules/
   * @deepseek-ai/dsh/lib/bin.js); we need the real path to run it with node.
   */
  resolveDshScript(dshBin: string): string | null {
    try {
      const real = fs.realpathSync(dshBin);
      return real;
    } catch {
      return null;
    }
  }

  /** Effective DSH_HOME (expand ~). */
  dshHome(): string {
    const home = this.settings.dshHome.trim() || '~/.dsh';
    if (home === '~/.dsh') {
      return path.join(os.homedir(), '.dsh');
    }
    return home.startsWith('~/') ? path.join(os.homedir(), home.slice(2)) : home;
  }

  /**
   * Plugin-owned DSH_HOME: an isolated directory inside the vault so the
   * per-task model / reasoning settings never pollute the user's global
   * `~/.dsh` (which the web app also reads). Credentials are symlinked from
   * the user's real DSH_HOME; settings.yaml is (re)written on every task
   * with the currently selected model + reasoning effort.
   *
   * Returns the plugin home, or null on failure (caller falls back to the
   * user home, where the model dropdown is then ignored).
   */
  ensurePluginDshHome(
    vaultRoot: string,
    sel: { model: string; effort: string },
  ): string | null {
    const base = path.join(vaultRoot, '.obsidian', 'plugins', 'dsh-obsidian', 'dsh-home');
    try {
      fs.mkdirSync(base, { recursive: true });
      // Reuse credentials from the user's real DSH home (symlink once).
      const credSrc = path.join(this.dshHome(), '.credentials.yaml');
      const credDst = path.join(base, '.credentials.yaml');
      if (fs.existsSync(credSrc) && !fs.existsSync(credDst)) {
        fs.symlinkSync(credSrc, credDst);
      }
      // The deepseek provider consumes `agent-default-model` settings
      // section (provider/model) plus its reasoningEffort.
      const settings = [
        'agent-default-model:',
        '  provider: deepseek-official',
        `  model: ${sel.model}`,
        `  reasoningEffort: ${sel.effort}`,
        '',
      ].join('\n');
      fs.writeFileSync(path.join(base, 'settings.yaml'), settings, 'utf8');
      return base;
    } catch {
      return null;
    }
  }

  /**
   * Directory the agent works on. Empty = vault root.
   * Returns an absolute path; ensures it exists.
   */
  workdir(vaultRoot: string): string {
    const rel = this.settings.workdir.trim();
    const base = rel ? path.join(vaultRoot, rel) : vaultRoot;
    try {
      fs.mkdirSync(base, { recursive: true });
    } catch {
      // read-only vault subpath: fall back to root
    }
    return base;
  }

  /**
   * Generate (once per vault) the persona patch overlay that turns the
   * generic coding agent into a vault-aware assistant.
   */
  async ensureVaultPatch(vaultRoot: string): Promise<string | null> {
    const dir = path.join(vaultRoot, '.obsidian', 'plugins', 'dsh-obsidian', 'generated');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return null;
    }
    const file = path.join(dir, 'vault.yml');
    if (fs.existsSync(file)) return file; // user may edit it; do not overwrite

    const persona = [
      '你是运行在 Obsidian vault 里的 DeepSeek Harness 助手。',
      '你的工作目录 {{cwd}} 就是用户的 vault。',
      '规则:',
      '1. 新建笔记使用 Markdown + YAML frontmatter,笔记间用 [[wikilink]] 互链。',
      '2. 需要修改 vault 内文件时直接用文件工具完成,不要只给代码。',
      '3. 删除/覆盖/移动等破坏性操作前,先向用户说明并征得同意。',
      '4. 用用户消息的语言回答。',
    ];
    if (this.settings.customPersona.trim()) {
      persona.push('', '附加用户指令:', this.settings.customPersona.trim());
    }

    const yaml = [
      '# 由 dsh-obsidian 生成。可自由编辑,插件不会覆盖此文件。',
      '- id: system-prompt',
      '  config:',
      '    persona: >-',
      ...persona.map((line) => `      ${line}`),
      '',
    ].join('\n');

    try {
      fs.writeFileSync(file, yaml, 'utf8');
      return file;
    } catch {
      return null;
    }
  }

  /** Assemble the final task text handed to `dsh --profile headless`. */
  buildTask(userMessage: string, memory: string[], extraContext?: string): string {
    const parts: string[] = [];
    if (this.settings.memoryEnabled && memory.length > 0) {
      parts.push(memory.join('\n'));
    }
    if (extraContext && extraContext.trim()) {
      parts.push(`[上下文]\n${extraContext.trim()}`);
    }
    parts.push(userMessage);
    return parts.join('\n\n');
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}
