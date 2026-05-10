import { SyncBadge } from './SyncBadge';
import type { SyncStatus } from '../types';
import logoUrl from '../assets/logo.png';

interface Props {
  syncStatus: SyncStatus;
  search: string;
  onSearchChange: (next: string) => void;
  onSyncNow: () => void;
  syncDisabled?: boolean;
  onOpenSettings: () => void;
  onNewNote: () => void;
}

export function TopBar({
  syncStatus,
  search,
  onSearchChange,
  onSyncNow,
  syncDisabled,
  onOpenSettings,
  onNewNote,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <img className="brand-mark" src={logoUrl} alt="" width={28} height={28} />
          <span className="brand-name">Zero Notes</span>
        </div>
      </div>

      <div className="topbar-mid">
        <input
          className="search-input"
          type="search"
          placeholder="Search notes…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="topbar-right">
        <SyncBadge status={syncStatus} />
        <button
          className="btn btn-ghost"
          onClick={onSyncNow}
          disabled={syncDisabled || syncStatus.state === 'syncing'}
          title="Sync now (Ctrl+Shift+S)"
        >
          {syncStatus.state === 'syncing' ? 'Syncing…' : 'Sync Now'}
        </button>
        <button
          className="btn btn-primary"
          onClick={onNewNote}
          title="New note (Ctrl+N)"
        >
          + New
        </button>
        <button
          className="btn btn-ghost icon-btn"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
