import { App, Notice } from 'obsidian';

/**
 * Session-based history: completed conversations are archived as session
 * records (a session = the turns since the last "clear conversation").
 * The in-memory current session is not persisted until it is ended (via
 * clear-conversation), then it joins the archived list, newest first.
 */

export interface HistoryTool {
  name: string;
  args: string;
  ok: boolean;
  summary?: string;
}

export interface HistoryTurn {
  ts: number;
  user: string;
  answer: string;
  thinking?: string;
  tools?: HistoryTool[];
  durationMs: number;
}

export interface SessionRecord {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number;
  model: string;
  effort: string;
  permission: string;
  turns: HistoryTurn[];
  /** Pinned sessions always sort above the rest. */
  pinned: boolean;
  /** User-editable note shown under the title. */
  note: string;
}

function newId(): string {
  return crypto.randomUUID();
}

function titleFromTurn(user: string): string {
  const t = user.replace(/\s+/g, ' ').trim();
  return t.length > 30 ? `${t.slice(0, 30)}…` : t || '新会话';
}

export class HistoryStore {
  private sessions: SessionRecord[] = [];
  private current: SessionRecord;

  constructor(
    private app: App,
    private file: string,
    private limit: number,
  ) {
    this.current = this.newSession();
  }

  /** Archived sessions: pinned first, then newest first. */
  getSessions(): SessionRecord[] {
    return [...this.sessions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.endedAt - a.endedAt;
    });
  }

  /** The in-memory session still being edited (not archived yet). */
  getCurrentSession(): SessionRecord {
    return this.current;
  }

  setLimit(limit: number): void {
    this.limit = limit;
    this.trim();
    void this.save();
  }

  async load(): Promise<void> {
    try {
      const raw = await this.app.vault.adapter.read(this.file);
      const parsed = JSON.parse(raw) as { sessions?: SessionRecord[] };
      this.sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.map((s) => ({ ...s, pinned: s.pinned ?? false, note: s.note ?? '' }))
        : [];
      this.trim();
    } catch {
      this.sessions = [];
    }
  }

  /** Append one turn to the current session. */
  async addTurn(
    turn: HistoryTurn,
    meta: { model: string; effort: string; permission: string },
  ): Promise<void> {
    if (this.current.turns.length === 0) {
      this.current.title = titleFromTurn(turn.user);
      this.current.startedAt = turn.ts;
      this.current.model = meta.model;
      this.current.effort = meta.effort;
      this.current.permission = meta.permission;
    }
    this.current.turns.push(turn);
    this.current.endedAt = turn.ts;
  }

  /** Archive the current session (if it has turns) and start a new one. */
  async endSession(): Promise<void> {
    if (this.current.turns.length === 0) return;
    this.sessions.push(this.current);
    this.trim();
    this.current = this.newSession();
    await this.save();
  }

  /**
   * Re-activate an archived session as the current one: future turns are
   * appended back into it, so resuming the same session repeatedly keeps a
   * continuous context. Returns the activated session, or null if missing.
   */
  async activateSession(id: string): Promise<SessionRecord | null> {
    if (this.current.turns.length > 0) {
      this.sessions.push(this.current);
    }
    const idx = this.sessions.findIndex((x) => x.id === id);
    if (idx === -1) {
      // nothing to activate; keep the archived current we just pushed
      this.trim();
      await this.save();
      return null;
    }
    const activated = this.sessions[idx];
    this.sessions.splice(idx, 1);
    this.current = activated;
    this.current.endedAt = Date.now();
    this.trim();
    await this.save();
    return activated;
  }

  async removeSession(id: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    await this.save();
  }

  /** Rename an archived session. */
  async renameSession(id: string, title: string): Promise<void> {
    const s = this.sessions.find((x) => x.id === id);
    if (s) {
      s.title = title.trim() || s.title;
      await this.save();
    }
  }

  /** Toggle the pinned flag of an archived session. */
  async togglePin(id: string): Promise<void> {
    const s = this.sessions.find((x) => x.id === id);
    if (s) {
      s.pinned = !s.pinned;
      await this.save();
    }
  }

  /** Edit the note of an archived session. */
  async setNote(id: string, note: string): Promise<void> {
    const s = this.sessions.find((x) => x.id === id);
    if (s) {
      s.note = note.trim();
      await this.save();
    }
  }

  async clear(): Promise<void> {
    this.sessions = [];
    this.current = this.newSession();
    await this.save();
  }

  private newSession(): SessionRecord {
    const now = Date.now();
    return {
      id: newId(),
      title: '新会话',
      startedAt: now,
      endedAt: now,
      model: '',
      effort: '',
      permission: '',
      turns: [],
      pinned: false,
      note: '',
    };
  }

  private trim(): void {
    this.sessions.sort((a, b) => b.endedAt - a.endedAt);
    if (this.sessions.length > this.limit) {
      this.sessions = this.sessions.slice(0, this.limit);
    }
  }

  private async save(): Promise<void> {
    try {
      await this.app.vault.adapter.write(this.file, JSON.stringify({ sessions: this.sessions }, null, 2));
    } catch (e) {
      new Notice(`历史会话保存失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
