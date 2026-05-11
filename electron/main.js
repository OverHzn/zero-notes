'use strict';

// Electron main process for Zero Notes.
//
// Responsibilities:
//   * Create the BrowserWindow with secure defaults (contextIsolation on,
//     nodeIntegration off, sandbox where possible).
//   * Wire up all IPC handlers — every native-side capability (SQLite, Google
//     OAuth, Drive appDataFolder sync, crypto, tokens) lives in this process.
//   * Manage app lifecycle (sync on start, sync on quit, periodic sync timer).
//
// Renderer code communicates only through the preload bridge in `preload.js`,
// which exposes `window.zeroNotes` — the renderer can never touch SQLite or
// Google APIs directly.

const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');

const db = require('./db');
const googleAuth = require('./google-auth');
const googleDrive = require('./google-drive');
const sync = require('./sync');
const tokens = require('./tokens');
const settings = require('./settings');
const device = require('./device');

const IS_DEV = !!process.env.ZN_DEV;
const RENDERER_DEV_URL = 'http://localhost:5173';

let mainWindow = null;
let autoSyncTimer = null;
const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes per spec.

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0f1115',
    title: 'Zero Notes',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // keytar/better-sqlite3 require non-sandboxed preload host
      webSecurity: true,
      spellcheck: true,
    },
  });

  // Block all in-app navigation away from our renderer; force external URLs to
  // the OS browser so OAuth and links never run inside the Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (IS_DEV && url.startsWith(RENDERER_DEV_URL)) return;
    if (url.startsWith('file://')) return;
    e.preventDefault();
    shell.openExternal(url).catch(() => {});
  });

  if (IS_DEV) {
    mainWindow.loadURL(RENDERER_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function broadcast(channel, payload) {
  try {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch (err) {
    // The webContents may have been disposed mid-broadcast (e.g. during
    // shutdown); never let an event-broadcast failure escape into IPC handlers.
    console.warn(`[zero-notes] broadcast(${channel}) failed:`, err.message);
  }
}

function registerIpcHandlers() {
  // ---- Notes -----------------------------------------------------------------
  ipcMain.handle('notes:list', (_e, opts) => db.listNotes(opts || {}));
  ipcMain.handle('notes:get', (_e, id) => db.getNote(id));
  ipcMain.handle('notes:create', (_e, partial) => db.createNote(partial || {}));
  ipcMain.handle('notes:update', (_e, id, patch) => db.updateNote(id, patch || {}));
  ipcMain.handle('notes:delete', (_e, id) => db.softDeleteNote(id));
  ipcMain.handle('notes:togglePin', (_e, id) => db.togglePin(id));
  ipcMain.handle('notes:search', (_e, query) => db.searchNotes(query || ''));

  // ---- Folders ---------------------------------------------------------------
  ipcMain.handle('folders:list', () => db.listFolders());
  ipcMain.handle('folders:create', (_e, name) => db.createFolder(name));
  ipcMain.handle('folders:rename', (_e, id, name) => db.renameFolder(id, name));
  ipcMain.handle('folders:delete', (_e, id) => db.deleteFolder(id));

  // ---- Tags ------------------------------------------------------------------
  ipcMain.handle('tags:list', () => db.listTags());

  // ---- Settings --------------------------------------------------------------
  ipcMain.handle('settings:get', () => settings.getAll());
  ipcMain.handle('settings:set', (_e, key, value) => settings.set(key, value));

  // ---- Device + meta ---------------------------------------------------------
  ipcMain.handle('app:meta', () => ({
    version: app.getVersion(),
    deviceId: device.getDeviceId(),
    platform: process.platform,
    dbPath: db.getDbPath(),
    appDataPath: app.getPath('userData'),
  }));

  // ---- Google auth -----------------------------------------------------------
  ipcMain.handle('auth:status', async () => {
    const t = await tokens.read();
    if (!t) return { connected: false };
    return {
      connected: true,
      email: t.profile?.email || null,
      name: t.profile?.name || null,
      picture: t.profile?.picture || null,
      tokenExpiry: t.expiry_date || null,
    };
  });
  ipcMain.handle('auth:login', async () => {
    const result = await googleAuth.loginInteractive();
    broadcast('auth:changed', result);
    return result;
  });
  ipcMain.handle('auth:logout', async () => {
    await googleAuth.logout();
    broadcast('auth:changed', { connected: false });
    return { connected: false };
  });

  // ---- Sync ------------------------------------------------------------------
  ipcMain.handle('sync:status', () => sync.getStatus());
  ipcMain.handle('sync:now', async () => {
    const result = await sync.runOnce({ trigger: 'manual', broadcast });
    return result;
  });

  // ---- External links --------------------------------------------------------
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (typeof url !== 'string') return false;
    if (!/^https?:\/\//i.test(url)) return false;
    shell.openExternal(url).catch(() => {});
    return true;
  });
}

function setApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => broadcast('shortcut:newNote'),
        },
        { type: 'separator' },
        {
          label: 'Sync Now',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => broadcast('shortcut:syncNow'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function startAutoSyncLoop() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = setInterval(() => {
    sync
      .runOnce({ trigger: 'auto', broadcast })
      .catch((err) => console.error('[zero-notes] auto-sync failed', err));
  }, AUTO_SYNC_INTERVAL_MS);
}

// Single-instance lock so launching the installed app twice just focuses the
// existing window — important for sync correctness (one DB owner at a time).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    db.init();
    settings.init();
    sync.init({ db, googleDrive, tokens, settings, device, broadcast: (c, p) => broadcast(c, p) });

    registerIpcHandlers();
    setApplicationMenu();
    createMainWindow();

    // Sync on app start (will no-op if not signed in / offline).
    sync
      .runOnce({ trigger: 'startup', broadcast })
      .catch((err) => console.error('[zero-notes] startup sync failed', err));

    startAutoSyncLoop();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('before-quit', async (e) => {
    if (sync.isShutdownSyncDone()) return;
    e.preventDefault();
    try {
      await sync.runOnce({ trigger: 'shutdown', broadcast });
    } catch (err) {
      console.error('[zero-notes] shutdown sync failed', err);
    } finally {
      sync.markShutdownSyncDone();
      if (autoSyncTimer) clearInterval(autoSyncTimer);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
