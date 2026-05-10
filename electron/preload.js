'use strict';

// Secure preload bridge.
//
// Renderer process has nodeIntegration disabled and contextIsolation enabled,
// so it can ONLY access main-process capabilities through `window.zeroNotes`,
// defined here. Every method below maps 1:1 to a registered ipcMain handler.

const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

function on(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('zeroNotes', {
  // App / device meta.
  meta: () => invoke('app:meta'),

  // Notes.
  notes: {
    list: (opts) => invoke('notes:list', opts),
    get: (id) => invoke('notes:get', id),
    create: (partial) => invoke('notes:create', partial),
    update: (id, patch) => invoke('notes:update', id, patch),
    delete: (id) => invoke('notes:delete', id),
    togglePin: (id) => invoke('notes:togglePin', id),
    search: (query) => invoke('notes:search', query),
  },

  // Folders.
  folders: {
    list: () => invoke('folders:list'),
    create: (name) => invoke('folders:create', name),
    rename: (id, name) => invoke('folders:rename', id, name),
    delete: (id) => invoke('folders:delete', id),
  },

  // Tags.
  tags: {
    list: () => invoke('tags:list'),
  },

  // Settings.
  settings: {
    get: () => invoke('settings:get'),
    set: (key, value) => invoke('settings:set', key, value),
  },

  // Google auth.
  auth: {
    status: () => invoke('auth:status'),
    login: () => invoke('auth:login'),
    logout: () => invoke('auth:logout'),
  },

  // Sync.
  sync: {
    status: () => invoke('sync:status'),
    now: () => invoke('sync:now'),
  },

  // Open external URL via OS browser (helpful for "open Google Cloud Console").
  openExternal: (url) => invoke('shell:openExternal', url),

  // Renderer subscribes to push events: sync state, auth changes, shortcuts.
  on: {
    syncStatus: (cb) => on('sync:status', cb),
    authChanged: (cb) => on('auth:changed', cb),
    shortcutNewNote: (cb) => on('shortcut:newNote', cb),
    shortcutSyncNow: (cb) => on('shortcut:syncNow', cb),
  },
});
