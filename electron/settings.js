'use strict';

// Lightweight settings store backed by electron-store. Stored at
// <userData>/config.json in plain JSON (no secrets — tokens go through
// `tokens.js` which uses the OS keychain via keytar).

const Store = require('electron-store');

const DEFAULTS = {
  theme: 'dark',                       // 'dark' | 'light' | 'system'
  syncEnabled: true,                   // appDataFolder sync master switch
  encryptCloudSync: false,             // optional client-side encryption
  conflictStrategy: 'last-write-wins', // 'last-write-wins' | 'duplicate-on-conflict'
  autoSaveDebounceMs: 600,
};

let store = null;

function init() {
  store = new Store({
    name: 'config',
    defaults: DEFAULTS,
    clearInvalidConfig: true,
  });
}

function getAll() {
  if (!store) init();
  return { ...DEFAULTS, ...store.store };
}

function get(key) {
  if (!store) init();
  return store.get(key);
}

function set(key, value) {
  if (!store) init();
  store.set(key, value);
  return getAll();
}

module.exports = { init, getAll, get, set };
