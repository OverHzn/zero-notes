// Thin typed wrapper around the window.zeroNotes preload bridge.
// Centralising this gives us one place to handle errors and fall back when
// running in a plain browser (e.g. during Vite-only tests).

import type { ZeroNotesBridge } from './types';

export const api: ZeroNotesBridge = (window.zeroNotes ??
  ({
    // Browser-only stub used if the renderer is opened directly without the
    // Electron preload — keeps the dev experience from crashing entirely.
    meta: async () => ({
      version: '0.0.0-browser',
      deviceId: 'browser',
      platform: 'browser',
      dbPath: '(in-memory)',
      appDataPath: '(in-memory)',
    }),
    notes: {
      list: async () => [],
      get: async () => null,
      create: async () => {
        throw new Error('Electron preload bridge not available');
      },
      update: async () => {
        throw new Error('Electron preload bridge not available');
      },
      delete: async () => {
        throw new Error('Electron preload bridge not available');
      },
      togglePin: async () => {
        throw new Error('Electron preload bridge not available');
      },
      search: async () => [],
    },
    folders: {
      list: async () => [],
      create: async () => {
        throw new Error('Electron preload bridge not available');
      },
      rename: async () => {
        throw new Error('Electron preload bridge not available');
      },
      delete: async () => ({ ok: true as const }),
    },
    tags: { list: async () => [] },
    settings: {
      get: async () => ({
        theme: 'dark',
        syncEnabled: false,
        encryptCloudSync: false,
        conflictStrategy: 'last-write-wins',
        autoSaveDebounceMs: 600,
      }),
      set: async () => ({
        theme: 'dark',
        syncEnabled: false,
        encryptCloudSync: false,
        conflictStrategy: 'last-write-wins',
        autoSaveDebounceMs: 600,
      }),
    },
    auth: {
      status: async () => ({ connected: false }),
      login: async () => ({ connected: false }),
      logout: async () => ({ connected: false }),
    },
    sync: {
      status: async () => ({
        state: 'offline',
        lastSyncAt: null,
        lastError: null,
        lastTrigger: null,
        conflictsLastRun: 0,
      }),
      now: async () => ({ ok: false, skipped: true, reason: 'browser' }),
    },
    openExternal: async () => false,
    on: {
      syncStatus: () => () => {},
      authChanged: () => () => {},
      shortcutNewNote: () => () => {},
      shortcutSyncNow: () => () => {},
    },
  } satisfies ZeroNotesBridge));
