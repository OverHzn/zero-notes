import type { Note } from '../types';
import { formatRelativeTime, deriveTitle } from '../util';

interface Props {
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}

export function NoteList({ notes, selectedId, onSelect, onTogglePin, onDelete }: Props) {
  if (notes.length === 0) {
    return (
      <div className="note-list empty">
        <div className="note-list-empty">
          <p>No notes here yet.</p>
          <p className="muted">Press <kbd>Ctrl</kbd>+<kbd>N</kbd> to create one.</p>
        </div>
      </div>
    );
  }

  return (
    <ul className="note-list">
      {notes.map((n) => {
        const title = n.title || deriveTitle(n.content, 'Untitled');
        const preview = (n.content || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        return (
          <li
            key={n.id}
            className={`note-list-item ${n.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(n.id)}
          >
            <div className="note-list-row">
              <span className="note-list-title">
                {n.is_pinned && <span className="pin-indicator" title="Pinned">📌</span>}
                {title}
              </span>
              <span className="note-list-time">{formatRelativeTime(n.updated_at)}</span>
            </div>
            <div className="note-list-preview">{preview || <em className="muted">No content</em>}</div>
            <div className="note-list-meta">
              {n.tags.slice(0, 3).map((t) => (
                <span key={t} className="chip">#{t}</span>
              ))}
              {n.sync_status === 'pending_sync' && (
                <span className="chip chip-pending">unsynced</span>
              )}
              <span className="grow" />
              <button
                className="icon-btn-ghost"
                title={n.is_pinned ? 'Unpin' : 'Pin'}
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(n.id);
                }}
              >
                {n.is_pinned ? '📍' : '📌'}
              </button>
              <button
                className="icon-btn-ghost"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Move this note to trash?')) onDelete(n.id);
                }}
              >
                🗑
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
