import { useState } from 'react';
import type { Folder, TagSummary } from '../types';

export type SidebarSelection =
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'folder'; folderId: string | null }
  | { kind: 'tag'; tag: string }
  | { kind: 'trash' };

interface Props {
  folders: Folder[];
  tags: TagSummary[];
  selection: SidebarSelection;
  onSelect: (s: SidebarSelection) => void;
  onCreateFolder: (name: string) => Promise<void> | void;
  onRenameFolder: (id: string, name: string) => Promise<void> | void;
  onDeleteFolder: (id: string) => Promise<void> | void;
}

export function Sidebar({
  folders,
  tags,
  selection,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const [newFolder, setNewFolder] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const isSelected = (s: SidebarSelection): boolean => {
    if (s.kind !== selection.kind) return false;
    if (s.kind === 'folder' && selection.kind === 'folder')
      return s.folderId === selection.folderId;
    if (s.kind === 'tag' && selection.kind === 'tag') return s.tag === selection.tag;
    return true;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFolder.trim();
    if (!name) return;
    await onCreateFolder(name);
    setNewFolder('');
  };

  return (
    <aside className="sidebar">
      <nav className="sidebar-section">
        <button
          className={`nav-item ${isSelected({ kind: 'all' }) ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'all' })}
        >
          <span className="nav-icon">📓</span>
          <span>All notes</span>
        </button>
        <button
          className={`nav-item ${isSelected({ kind: 'pinned' }) ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'pinned' })}
        >
          <span className="nav-icon">📌</span>
          <span>Pinned</span>
        </button>
        <button
          className={`nav-item ${isSelected({ kind: 'folder', folderId: null }) ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'folder', folderId: null })}
        >
          <span className="nav-icon">📥</span>
          <span>Inbox (no folder)</span>
        </button>
        <button
          className={`nav-item ${isSelected({ kind: 'trash' }) ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'trash' })}
        >
          <span className="nav-icon">🗑️</span>
          <span>Trash</span>
        </button>
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-heading">Folders</div>
        <ul className="folder-list">
          {folders.map((f) => (
            <li
              key={f.id}
              className={`folder-item ${
                selection.kind === 'folder' && selection.folderId === f.id ? 'active' : ''
              }`}
            >
              {editingId === f.id ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = editingName.trim();
                    if (name && name !== f.name) await onRenameFolder(f.id, name);
                    setEditingId(null);
                  }}
                >
                  <input
                    className="folder-edit-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    autoFocus
                    onBlur={() => setEditingId(null)}
                  />
                </form>
              ) : (
                <button
                  className="folder-button"
                  onClick={() => onSelect({ kind: 'folder', folderId: f.id })}
                  onDoubleClick={() => {
                    setEditingId(f.id);
                    setEditingName(f.name);
                  }}
                  title="Double-click to rename"
                >
                  <span className="nav-icon">📁</span>
                  <span className="folder-name">{f.name}</span>
                </button>
              )}
              <button
                className="folder-delete"
                onClick={() => {
                  if (confirm(`Delete folder "${f.name}"? Notes will move to Inbox.`)) {
                    void onDeleteFolder(f.id);
                  }
                }}
                aria-label="Delete folder"
                title="Delete folder"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <form className="folder-add" onSubmit={handleAdd}>
          <input
            placeholder="+ New folder"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
          />
        </form>
      </div>

      {tags.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-heading">Tags</div>
          <ul className="tag-list">
            {tags.map((t) => (
              <li key={t.name}>
                <button
                  className={`tag-button ${
                    selection.kind === 'tag' && selection.tag === t.name ? 'active' : ''
                  }`}
                  onClick={() => onSelect({ kind: 'tag', tag: t.name })}
                >
                  <span className="nav-icon">#</span>
                  <span>{t.name}</span>
                  <span className="tag-count">{t.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
