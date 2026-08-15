import { describe, it, expect } from 'vitest';
import {
  parseHeadlessOutput,
  errorHint,
  versionCmp,
  contextWindowFor,
  MODEL_CONTEXT_WINDOWS,
} from './pure';
import { estimateTokens } from './context-meter';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('counts CJK chars as 1 token each', () => {
    expect(estimateTokens('你好世界')).toBe(4);
  });

  it('counts Latin chars as 1 token per 4 chars', () => {
    expect(estimateTokens('hello world')).toBe(3); // ceil(11/4)
  });

  it('mixes CJK and Latin correctly', () => {
    expect(estimateTokens('你好ab')).toBe(3); // 2 CJK + ceil(2/4)
  });
});

describe('parseHeadlessOutput', () => {
  it('strips DLEVENT lines and keeps the answer', () => {
    expect(parseHeadlessOutput('DLEVENT\t{"t":"think"}\nhello')).toBe('hello');
  });

  it('keeps non-DLEVENT lines in order', () => {
    expect(parseHeadlessOutput('DLEVENT\t{}\nline1\nDLEVENT\t{}\nline2\n')).toBe('line1\nline2');
  });

  it('passes plain text through untouched', () => {
    expect(parseHeadlessOutput('plain text')).toBe('plain text');
  });

  it('returns empty string for empty input', () => {
    expect(parseHeadlessOutput('')).toBe('');
  });
});

describe('errorHint', () => {
  it('maps credential codes to a hint', () => {
    expect(errorHint('INVALID_CREDENTIAL')).toBeTruthy();
    expect(errorHint('MISSING_CREDENTIAL')).toBeTruthy();
    expect(errorHint('NO_ADAPTER')).toBeTruthy();
  });

  it('maps quota/rate/timeout to hints', () => {
    expect(errorHint('QUOTA')).toBeTruthy();
    expect(errorHint('RATE_LIMIT')).toBeTruthy();
    expect(errorHint('TIMEOUT')).toBeTruthy();
  });

  it('returns null for unknown codes', () => {
    expect(errorHint('SOMETHING_UNKNOWN')).toBeNull();
  });
});

describe('versionCmp', () => {
  it('orders by major version numerically (not lexicographically)', () => {
    expect(versionCmp('v18.0.0', 'v9.0.0')).toBeGreaterThan(0);
    expect(versionCmp('v9.0.0', 'v18.0.0')).toBeLessThan(0);
    expect(versionCmp('v10.0.0', 'v9.0.0')).toBeGreaterThan(0);
  });

  it('orders by minor and patch when major is equal', () => {
    expect(versionCmp('v18.2.0', 'v18.1.0')).toBeGreaterThan(0);
    expect(versionCmp('v18.0.1', 'v18.0.0')).toBeGreaterThan(0);
  });

  it('returns 0 for equal versions', () => {
    expect(versionCmp('v18.0.0', 'v18.0.0')).toBe(0);
  });
});

describe('contextWindowFor', () => {
  it('resolves known models', () => {
    expect(contextWindowFor('deepseek-v4-flash')).toBe(1_000_000);
    expect(contextWindowFor('deepseek-v4-pro')).toBe(1_000_000);
  });

  it('falls back to the default for unknown models', () => {
    expect(contextWindowFor('unknown-model')).toBe(1_000_000);
  });

  it('exposes a window for every known model', () => {
    expect(Object.keys(MODEL_CONTEXT_WINDOWS).length).toBeGreaterThan(0);
  });
});
