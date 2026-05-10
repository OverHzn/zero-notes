import { useEffect, useMemo, useRef, useState } from 'react';
import type { Folder, Note } from '../types';
import { debounce, formatRelativeTime } from '../util';

interface Props {
  note: Note | null;
  folders: Folder[];
  onChange: (id: string, patch: Partial<Note>) => Promise<void>;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  debounceMs: number;
}

interface Draft {
  title: string;
  content: string;
  folder_id: string | null;
  tags: string;
}

function noteToDraft(note: Note | null): Draft | null {
  if (!note) return null;
  return {
    title: note.title,
    content: note.content,
    folder_id: note.folder_id,
    tags: note.tags.join(', '),
  };
}

export function Editor({ note, folders, onChange, onTogglePin, onDelete, debounceMs }: Props) {
  const [draft, setDraft] = useState<Draft | null>(noteToDraft(note));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const noteIdRef = useRef<string | null>(note?.id ?? null);

  // When note prop changes (different note selected), replace the draft.
  useEffect(() => {
    setDraft(noteToDraft(note));
    noteIdRef.current = note?.id ?? null;
    setSavedAt(null);
    // We intentionally re-sync the draft only when the *id* changes — the
    // user-typed content lives in `draft` and shouldn't be overwritten on
    // every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  const debouncedSave = useMemo(() => {
    return debounce(async (id: string, patch: Partial<Note>) => {
      try {
        await onChange(id, patch);
        setSavedAt(Date.now());
      } catch (err) {
        console.error('Failed to save note', err);
      }
    }, Math.max(150, debounceMs));
    // We deliberately rebuild this when debounceMs changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounceMs]);

  useEffect(() => {
    return () => debouncedSave.flush();
  }, [debouncedSave]);

  // Flush on note switch.
  useEffect(() => {
    return () => {
      debouncedSave.flush();
    };
  }, [note?.id, debouncedSave]);

  if (!note || !draft) {
    return (
      <div className="editor empty">
        <div className="editor-empty">
          <h2>Pick a note, or start a new one</h2>
          <p className="muted">Press <kbd>Ctrl</kbd>+<kbd>N</kbd> to create a note.</p>
        </div>
      </div>
    );
  }

  const update = (patch: Partial<Draft>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    const tags = next.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    debouncedSave(note.id, {
      title: next.title,
      content: next.content,
      folder_id: next.folder_id,
      tags,
    });
  };

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <select
          className="editor-folder"
          value={draft.folder_id ?? ''}
          onChange={(e) => update({ folder_id: e.target.value || null })}
        >
          <option value="">Inbox (no folder)</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <span className="grow" />
        <span className="muted small">
          {note.sync_status === 'pending_sync' ? 'Unsynced — local only' : 'Synced'}
          {savedAt ? ` · saved ${formatRelativeTime(savedAt)}` : ''}
        </span>
        <button
          className="btn btn-ghost"
          onClick={() => onTogglePin(note.id)}
          title={note.is_pinned ? 'Unpin' : 'Pin'}
        >
          {note.is_pinned ? 'Unpin' : 'Pin'}
        </button>
        <button
          className="btn btn-danger-ghost"
          onClick={() => {
            if (confirm('Move this note to trash?')) onDelete(note.id);
          }}
        >
          Delete
        </button>
      </div>

      <input
        className="editor-title"
        placeholder="Title"
        value={draft.title}
        onChange={(e) => update({ title: e.target.value })}
        spellCheck
      />
      <input
        className="editor-tags"
        placeholder="tags, separated, by commas"
        value={draft.tags}
        onChange={(e) => update({ tags: e.target.value })}
        spellCheck={false}
      />
      <textarea
        className="editor-content"
        placeholder="Start writing…"
        value={draft.content}
        onChange={(e) => update({ content: e.target.value })}
        spellCheck
      />
    </div>
  );
}
