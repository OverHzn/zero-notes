// Shared renderer types — these match the shapes returned by the main-process
// IPC handlers (see electron/db.js, sync.js, google-auth.js).

export interface Note {
  id: string;
  title: string;
  content: string;
  folder_id: string | null;
  tags: string[];
  is_pinned: boolean;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  sync_status: 'pending_sync' | 'synced';
}

export interface Folder {
  id: string;
  name: string;
  created_at: number;
}

export interface TagSummary {
  name: string;
  count: number;
}

export interface AppMeta {
  version: string;
  deviceId: string;
  platform: string;
  dbPath: string;
  appDataPath: string;
}

export interface AuthStatus {
  connected: boolean;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
  tokenExpiry?: number | null;
}

export type SyncState = 'offline' | 'syncing' | 'synced' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  lastError: string | null;
  lastTrigger: string | null;
  conflictsLastRun: number;
}

export interface SyncResult {
  ok: boolean;
  lastSyncAt?: number;
  conflicts?: number;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  syncEnabled: boolean;
  encryptCloudSync: boolean;
  encryptionPassphrase?: string;
  conflictStrategy: 'last-write-wins' | 'duplicate-on-conflict';
  autoSaveDebounceMs: number;
}

export type Unsubscribe = () => void;

export interface ZeroNotesBridge {
  meta: () => Promise<AppMeta>;
  notes: {
    list: (opts?: { folderId?: string | null; tag?: string; includeDeleted?: boolean; search?: string }) => Promise<Note[]>;
    get: (id: string) => Promise<Note | null>;
    create: (partial?: Partial<Note>) => Promise<Note>;
    update: (id: string, patch: Partial<Note>) => Promise<Note>;
    delete: (id: string) => Promise<Note>;
    togglePin: (id: string) => Promise<Note>;
    search: (query: string) => Promise<Note[]>;
  };
  folders: {
    list: () => Promise<Folder[]>;
    create: (name: string) => Promise<Folder>;
    rename: (id: string, name: string) => Promise<Folder>;
    delete: (id: string) => Promise<{ ok: true }>;
  };
  tags: {
    list: () => Promise<TagSummary[]>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    set: (key: keyof AppSettings, value: unknown) => Promise<AppSettings>;
  };
  auth: {
    status: () => Promise<AuthStatus>;
    login: () => Promise<AuthStatus>;
    logout: () => Promise<AuthStatus>;
  };
  sync: {
    status: () => Promise<SyncStatus>;
    now: () => Promise<SyncResult>;
  };
  openExternal: (url: string) => Promise<boolean>;
  on: {
    syncStatus: (cb: (s: SyncStatus) => void) => Unsubscribe;
    authChanged: (cb: (s: AuthStatus) => void) => Unsubscribe;
    shortcutNewNote: (cb: () => void) => Unsubscribe;
    shortcutSyncNow: (cb: () => void) => Unsubscribe;
  };
}

declare global {
  interface Window {
    zeroNotes: ZeroNotesBridge;
  }
}
