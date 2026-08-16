// @vitest-environment jsdom
/**
 * Regression tests for the chip editor. Polyfills the minimal Obsidian DOM
 * helpers (createDiv / createSpan / empty / toggleClass) that chip-editor
 * uses; jsdom's Selection is a stub, so caret placement is not asserted here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeEl = (tag: string, opts?: { cls?: string; text?: string }): HTMLElement => {
  const el = document.createElement(tag);
  if (opts?.cls) el.className = opts.cls;
  if (opts?.text) el.textContent = opts.text;
  return el;
};
const appendTo = (self: HTMLElement, opts?: { cls?: string; text?: string }): HTMLElement => {
  const el = makeEl(self.tagName.toLowerCase() === 'span' ? 'span' : 'div', opts);
  self.appendChild(el);
  return el;
};

(HTMLElement.prototype as unknown as Record<string, unknown>).empty = function (this: HTMLElement): void {
  this.innerHTML = '';
};
(HTMLElement.prototype as unknown as Record<string, unknown>).toggleClass = function (this: HTMLElement, cls: string, on: boolean): void {
  this.classList.toggle(cls, on);
};
(HTMLElement.prototype as unknown as Record<string, unknown>).createDiv = function (this: HTMLElement, opts?: { cls?: string; text?: string }): HTMLElement {
  return appendTo(this, opts);
};
(HTMLElement.prototype as unknown as Record<string, unknown>).createSpan = function (this: HTMLElement, opts?: { cls?: string; text?: string }): HTMLElement {
  return appendTo(this, opts);
};
(globalThis as Record<string, unknown>).createDiv = (opts?: { cls?: string; text?: string }): HTMLElement => makeEl('div', opts);
(globalThis as Record<string, unknown>).createSpan = (opts?: { cls?: string; text?: string }): HTMLElement => makeEl('span', opts);

import { ChipEditor } from './chip-editor';

const PATH = '09AI教师赋能项目/需求痛点挖掘/车棍儿老师AI备课-评论区态度分析报告';

function makeApp() {
  return { workspace: { openLinkText: vi.fn() } } as unknown as import('obsidian').App;
}

function makeEditor(app: ReturnType<typeof makeApp>): ChipEditor {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new ChipEditor(container, app, { placeholder: '输入任务…' });
}

describe('chip-editor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('serialization round-trips: chips → [[path]], text as-is', () => {
    const app = makeApp();
    const editor = makeEditor(app);
    editor.setText(`看这个 [[${PATH}]] 然后处理`);
    expect(editor.getText()).toBe(`看这个 [[${PATH}]] 然后处理`);
    expect(editor.el.querySelectorAll('.dsh-chip').length).toBe(1);
  });

  it('chip renders a label with the basename and is non-editable (atomic)', () => {
    const app = makeApp();
    const editor = makeEditor(app);
    editor.setText(`[[${PATH}]]`);
    const chip = editor.el.querySelector('.dsh-chip') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('contenteditable')).toBe('false');
    const label = chip.querySelector('.dsh-chip-label') as HTMLElement;
    expect(label).toBeTruthy();
    expect(label.textContent).toBe('车棍儿老师AI备课-评论区态度分析报告');
    expect(chip.getAttribute('title')).toBe(PATH);
  });

  it('mousedown on a chip opens the note without placing a caret', () => {
    const app = makeApp();
    const editor = makeEditor(app);
    editor.setText(`[[${PATH}]]`);
    const chip = editor.el.querySelector('.dsh-chip') as HTMLElement;
    const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    const prevented = !chip.dispatchEvent(evt); // dispatchEvent returns false when defaultPrevented
    expect(prevented).toBe(true);
    expect(app.workspace.openLinkText).toHaveBeenCalledWith(PATH, '');
  });

  it('@ token is visible through textBeforeCaret after typing', () => {
    const app = makeApp();
    const editor = makeEditor(app);
    editor.focus();
    const tn = document.createTextNode('@q');
    editor.el.appendChild(tn);
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(tn, 2);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(editor.textBeforeCaret()).toBe('@q');
  });

  it('replaceRange after a chip keeps the [[path]] serialization', () => {
    const app = makeApp();
    const editor = makeEditor(app);
    editor.setText(`看这个 [[${PATH}]]`);
    editor.replaceRange(editor.textBeforeCaret().length, '@');
    expect(editor.getText()).toBe(`看这个 [[${PATH}]]@`);
  });
});
