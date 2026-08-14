import { spawn, ChildProcess } from 'child_process';

/**
 * Thin bridge between the plugin and the DeepSeek Harness CLI.
 *
 * The plugin never implements agent execution itself: it spawns
 * `dsh --profile headless "<task>"` with cwd = vault root, and the
 * harness agent uses its full toolset (bash, file tools, web search,
 * subagents, …) directly on the vault, under DSH's own file sandbox.
 */

export interface DshRunOptions {
  /** Binary path to the `dsh` CLI (used when nodeBin+dshScript are not given). */
  dshBin: string;
  /** Absolute path to a Node.js binary. Preferred over the dsh shebang:
   *  Obsidian's Electron process has a restricted PATH that usually lacks
   *  Homebrew/nvm dirs, so `#!/usr/bin/env node` fails with
   *  "env: node: No such file or directory". */
  nodeBin?: string;
  /** Absolute path to dsh's real bin.js entry (resolve symlinks). */
  dshScript?: string;
  /** Absolute working directory for the agent (the vault root). */
  cwd: string;
  /** DSH_HOME (credentials/config root). Defaults to ~/.dsh. */
  dshHome?: string;
  /** Tool execution backend for the harness: '' (native default) | 'native' | 'code' | 'both'. */
  toolsMode?: string;
  /** DSH sandbox mode: read-only | workspace-write | danger-full-access. */
  permissionMode?: string;
  /** Path(s) to generated `--patch` overlays (repeatable). */
  patchPath?: string | string[];
  /** Kill the process after this many ms. 0 = no timeout. */
  timeoutMs?: number;
  /** Line-by-line stdout callback (used by the Phase-2 stream relay). */
  onStdoutLine?: (line: string) => void;
  /** Cancellation signal (user pressed Stop). */
  signal?: AbortSignal;
}

export interface DshRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True when terminated by user/timeout rather than by dsh itself. */
  killed: boolean;
}

export interface DshDiagnostics {
  bin: string;
  found: boolean;
  version: string | null;
  /** Non-empty when a binary-level problem was detected. */
  error: string | null;
  /** Detected Node.js binary path (may be null). */
  nodeBin: string | null;
}

export class DshClient {
  private child: ChildProcess | null = null;

  /**
   * Run one headless task to completion.
   * Resolves with stdout (the agent's final answer) plus metadata.
   */
  run(task: string, opts: DshRunOptions): Promise<DshRunResult> {
    return new Promise((resolve) => {
      const args = ['--profile', 'headless'];
      const patches = Array.isArray(opts.patchPath)
        ? opts.patchPath
        : opts.patchPath ? [opts.patchPath] : [];
      for (const p of patches) {
        args.push('--patch', p);
      }
      args.push(task);

      // Prefer spawning node directly with dsh's real entry script: this
      // bypasses the shebang, which fails under Electron's restricted PATH.
      const useNodeDirect = Boolean(opts.nodeBin && opts.dshScript);
      const spawnBin = useNodeDirect ? opts.nodeBin! : opts.dshBin;
      const spawnArgs = useNodeDirect ? [opts.dshScript!, ...args] : args;

      const env: Record<string, string> = { ...process.env as Record<string, string> };
      if (opts.dshHome) env.DSH_HOME = opts.dshHome;
      // DSH_TOOLS_MODE selects the tool execution backend (native/code/both);
      // only set it when the user explicitly chose one. It is NOT a file
      // sandbox knob — file tools scope to the session cwd (= the vault).
      if (opts.toolsMode) env.DSH_TOOLS_MODE = opts.toolsMode;
      // DSH_PERMISSION_MODE selects the sandbox mode (read-only /
      // workspace-write / danger-full-access), consumed by dsh-sandbox-policy
      // and dsh-permission-presets in the base bundle.
      if (opts.permissionMode) env.DSH_PERMISSION_MODE = opts.permissionMode;
      // Make sure the agent's own bash tool can still find node/npm.
      if (opts.nodeBin) {
        const nodeDir = opts.nodeBin.substring(0, opts.nodeBin.lastIndexOf('/'));
        env.PATH = [nodeDir, env.PATH || '/usr/bin:/bin'].join(':');
      }

      const startedAt = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;
      let settled = false;

      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        if (this.child === child) this.child = null;
        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          killed,
        });
      };

      const child = spawn(spawnBin, spawnArgs, {
        cwd: opts.cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;

      let stdoutBuffer = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        // Always accumulate the full stdout (final answer may span lines);
        // the buffer is only for line-splitting callbacks.
        stdout += text;
        stdoutBuffer += text;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? ''; // keep the incomplete tail
        for (const line of lines) {
          if (line.trim() && opts.onStdoutLine) opts.onStdoutLine(line);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        // e.g. ENOENT when the binary does not exist
        stderr += `spawn error: ${err.message}`;
        finish(null);
      });

      child.on('close', (code) => {
        // Flush the incomplete tail to line callbacks (stdout already holds it).
        if (stdoutBuffer.trim() && opts.onStdoutLine) {
          opts.onStdoutLine(stdoutBuffer);
        }
        finish(code);
      });

      // Timeout
      if (opts.timeoutMs && opts.timeoutMs > 0) {
        const timer = setTimeout(() => {
          killed = true;
          this.killChild(child);
        }, opts.timeoutMs);
        child.on('close', () => clearTimeout(timer));
      }

      // User cancellation
      if (opts.signal) {
        if (opts.signal.aborted) {
          killed = true;
          this.killChild(child);
        } else {
          opts.signal.addEventListener('abort', () => {
            killed = true;
            this.killChild(child);
          }, { once: true });
        }
      }
    });
  }

  /** Terminate the currently running child (SIGTERM, then SIGKILL). */
  stop(): void {
    if (this.child && !this.child.killed) {
      this.killChild(this.child);
    }
  }

  isRunning(): boolean {
    return this.child !== null;
  }

  /** Kill any live children (plugin unload). */
  dispose(): void {
    this.stop();
  }

  private killChild(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill('SIGTERM');
      // Escalate after a grace period.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }
      }, 3000);
    } catch {
      // Already gone
    }
  }
}
