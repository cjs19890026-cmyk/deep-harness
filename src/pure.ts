/**
 * Obsidian-free pure helpers, extracted so they can be unit-tested in Node
 * without pulling in the `obsidian` API.
 */
import { t } from './i18n';

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

/** Map a dsh error CODE to a user-friendly message; null = unknown code. */
export function errorHint(code: string): string | null {
  switch (code) {
    case 'INVALID_CREDENTIAL':
    case 'MISSING_CREDENTIAL':
    case 'NO_ADAPTER':
      return t('chat.noCredential');
    case 'QUOTA':
      return t('chat.errQuota');
    case 'RATE_LIMIT':
      return t('chat.errRateLimit');
    case 'TIMEOUT':
      return t('chat.errTimeout');
    case 'TRANSPORT':
    case 'SERVER':
      return t('chat.errNetwork');
    case 'CONTEXT_WINDOW_EXCEEDED':
      return t('chat.errContextWindow');
    case 'SANDBOX_UNAVAILABLE':
      return t('chat.errSandbox');
    default:
      return null;
  }
}

/** Numeric semver compare for nvm "vX.Y.Z" dirs (a < b => negative). */
export function versionCmp(a: string, b: string): number {
  const key = (v: string): number[] => {
    const m = v.match(/^v(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < 3; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

/** Default context window when the model isn't in the map. */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** Context window (tokens) per model id. */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
};

/** Resolve the context window for a model id (safe default). */
export function contextWindowFor(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}
