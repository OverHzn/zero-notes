import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar, type SidebarSelection } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { Editor } from './components/Editor';
import { Settings } from './components/Settings';
import { api } from './api';
import type {
  AppMeta,
  AppSettings,
  AuthStatus,
  Folder,
  Note,
  SyncStatus,
  TagSummary,
} from './types';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  syncEnabled: true,
  encryptCloudSync: false,
  conflictStrategy: 'last-write-wins',
  autoSaveDebounceMs: 600,
};

const DEFAULT_SYNC: SyncStatus = {
  state: 'offline',
  lastSyncAt: null,
  lastError: null,
  lastTrigger: null,
  conflictsLastRun: 0,
};

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [selection, setSelection] = useState<SidebarSelection>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const [authStatus, setAuthStatus] = useState<AuthStatus>({ connected: false });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(DEFAULT_SYNC);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [meta, setMeta] = useState<AppMeta | null>(null);

  // Apply theme.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // Initial load.
  useEffect(() => {
    void (async () => {
      const [m, s, a, syn] = await Promise.all([
        api.meta(),
        api.settings.get(),
        api.auth.status(),
        api.sync.status(),
      ]);
      setMeta(m);
      setSettings(s);
      setAuthStatus(a);
      setSyncStatus(syn);
    })();
  }, []);

  // Live event subscriptions.
  useEffect(() => {
    const unSync = api.on.syncStatus((s) => setSyncStatus(s));
    const unAuth = api.on.authChanged((a) => setAuthStatus(a));
    const unNew = api.on.shortcutNewNote(() => void handleNewNote());
    const unSyncNow = api.on.shortcutSyncNow(() => void handleSyncNow());
    return () => {
      unSync();
      unAuth();
      unNew();
      unSyncNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadFolders = useCallback(async () => {
    const f = await api.folders.list();
    setFolders(f);
  }, []);

  const reloadTags = useCallback(async () => {
    const t = await api.tags.list();
    setTags(t);
  }, []);

  const reloadNotes = useCallback(async () => {
    const opts: Parameters<typeof api.notes.list>[0] = {};
    if (search.trim()) opts.search = search.trim();
    if (selection.kind === 'folder') opts.folderId = selection.folderId;
    if (selection.kind === 'tag') opts.tag = selection.tag;
    if (selection.kind === 'trash') opts.includeDeleted = true;
    const list = await api.notes.list(opts);

    let filtered = list;
    if (selection.kind === 'pinned') filtered = list.filter((n) => n.is_pinned);
    if (selection.kind === 'trash') filtered = list.filter((n) => n.deleted_at);
    if (selection.kind !== 'trash') filtered = filtered.filter((n) => !n.deleted_at);

    setNotes(filtered);
  }, [search, selection]);

  useEffect(() => {
    void reloadFolders();
    void reloadTags();
  }, [reloadFolders, reloadTags]);

  useEffect(() => {
    void reloadNotes();
  }, [reloadNotes]);

  // Keep selectedNote in sync with selectedId. We re-fetch from main on every
  // change to be sure we have the canonical record.
  useEffect(() => {
    if (!selectedId) {
      setSelectedNote(null);
      return;
    }
    void api.notes.get(selectedId).then((n) => setSelectedNote(n));
  }, [selectedId, notes]);

  // Refresh notes when sync just finished (so remote changes show up).
  const lastSyncedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (syncStatus.state === 'synced' && syncStatus.lastSyncAt !== lastSyncedAtRef.current) {
      lastSyncedAtRef.current = syncStatus.lastSyncAt;
      void reloadNotes();
      void reloadFolders();
      void reloadTags();
    }
  }, [syncStatus.state, syncStatus.lastSyncAt, reloadNotes, reloadFolders, reloadTags]);

  const handleNewNote = useCallback(async () => {
    const folderId =
      selection.kind === 'folder' && selection.folderId ? selection.folderId : null;
    const tagsForNew =
      selection.kind === 'tag' ? [selection.tag] : [];
    const note = await api.notes.create({
      title: '',
      content: '',
      folder_id: folderId,
      tags: tagsForNew,
    });
    await reloadNotes();
    await reloadTags();
    setSelectedId(note.id);
  }, [selection, reloadNotes, reloadTags]);

  const handleUpdate = useCallback(
    async (id: string, patch: Partial<Note>) => {
      const updated = await api.notes.update(id, patch);
      setSelectedNote(updated);
      // Refresh the list so titles/preview update.
      await reloadNotes();
      await reloadTags();
    },
    [reloadNotes, reloadTags]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await api.notes.delete(id);
      if (selectedId === id) setSelectedId(null);
      await reloadNotes();
      await reloadTags();
    },
    [selectedId, reloadNotes, reloadTags]
  );

  const handleTogglePin = useCallback(
    async (id: string) => {
      await api.notes.togglePin(id);
      await reloadNotes();
      if (selectedId === id) {
        const fresh = await api.notes.get(id);
        setSelectedNote(fresh);
      }
    },
    [reloadNotes, selectedId]
  );

  const handleSyncNow = useCallback(async () => {
    await api.sync.now();
    // sync:status event will refresh state via subscription.
  }, []);

  const handleLogin = useCallback(async () => {
    const next = await api.auth.login();
    setAuthStatus(next);
    if (next.connected) void api.sync.now();
  }, []);

  const handleLogout = useCallback(async () => {
    const next = await api.auth.logout();
    setAuthStatus(next);
  }, []);

  const handleUpdateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const next = await api.settings.set(key, value);
      setSettings(next);
    },
    []
  );

  const handleCreateFolder = useCallback(
    async (name: string) => {
      await api.folders.create(name);
      await reloadFolders();
    },
    [reloadFolders]
  );

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      await api.folders.rename(id, name);
      await reloadFolders();
    },
    [reloadFolders]
  );

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      await api.folders.delete(id);
      await reloadFolders();
      await reloadNotes();
    },
    [reloadFolders, reloadNotes]
  );

  const visibleNotes = useMemo(() => notes, [notes]);

  return (
    <div className="app-shell">
      <TopBar
        syncStatus={syncStatus}
        search={search}
        onSearchChange={setSearch}
        onSyncNow={handleSyncNow}
        syncDisabled={!authStatus.connected || !settings.syncEnabled}
        onOpenSettings={() => setShowSettings(true)}
        onNewNote={handleNewNote}
      />
      <main className="main-grid">
        <Sidebar
          folders={folders}
          tags={tags}
          selection={selection}
          onSelect={(s) => {
            setSelection(s);
            setSelectedId(null);
          }}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
        />
        <div className="middle-column">
          <NoteList
            notes={visibleNotes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onTogglePin={handleTogglePin}
            onDelete={handleDelete}
          />
        </div>
        <div className="right-column">
          <Editor
            note={selectedNote}
            folders={folders}
            onChange={handleUpdate}
            onTogglePin={handleTogglePin}
            onDelete={handleDelete}
            debounceMs={settings.autoSaveDebounceMs}
          />
        </div>
      </main>
      {showSettings && (
        <Settings
          authStatus={authStatus}
          syncStatus={syncStatus}
          settings={settings}
          meta={meta}
          onClose={() => setShowSettings(false)}
          onLogin={handleLogin}
          onLogout={handleLogout}
          onSyncNow={handleSyncNow}
          onUpdateSetting={handleUpdateSetting}
        />
      )}
    </div>
  );
}
