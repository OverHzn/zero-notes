'use strict';

// Secure token storage.
//
// On Windows / macOS / Linux (with libsecret), `keytar` stores values in the
// OS credential vault. On systems without an OS keychain (some headless Linux
// boxes), keytar throws when loading — we fall back to an encrypted file in
// the user data dir using Electron's `safeStorage` API.
//
// We store ONE record under service "ZeroNotes", account "google" containing
// the full token payload (access_token, refresh_token, expiry_date, scope,
// token_type, profile { email, name, picture }) as JSON.

const path = require('node:path');
const fs = require('node:fs');
const { app, safeStorage } = require('electron');

const SERVICE = 'ZeroNotes';
const ACCOUNT = 'google';

let keytar = null;
try {
  // eslint-disable-next-line global-require
  keytar = require('keytar');
} catch (err) {
  console.warn('[zero-notes] keytar unavailable, falling back to safeStorage', err.message);
}

function fallbackFile() {
  return path.join(app.getPath('userData'), 'tokens.bin');
}

async function readKeytar() {
  if (!keytar) return null;
  try {
    const raw = await keytar.getPassword(SERVICE, ACCOUNT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[zero-notes] keytar read failed', err);
    return null;
  }
}

async function writeKeytar(payload) {
  if (!keytar) return false;
  try {
    await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('[zero-notes] keytar write failed', err);
    return false;
  }
}

async function deleteKeytar() {
  if (!keytar) return false;
  try {
    await keytar.deletePassword(SERVICE, ACCOUNT);
    return true;
  } catch {
    return false;
  }
}

function readFallback() {
  const file = fallbackFile();
  if (!fs.existsSync(file)) return null;
  try {
    const buf = fs.readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) {
      const text = safeStorage.decryptString(buf);
      return JSON.parse(text);
    }
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    console.warn('[zero-notes] fallback token read failed', err);
    return null;
  }
}

function writeFallback(payload) {
  const file = fallbackFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(JSON.stringify(payload));
    fs.writeFileSync(file, enc, { mode: 0o600 });
  } else {
    // Last resort. Better than nothing; warn loudly.
    console.warn('[zero-notes] safeStorage encryption unavailable — tokens stored in plaintext');
    fs.writeFileSync(file, JSON.stringify(payload), { mode: 0o600 });
  }
}

function deleteFallback() {
  const file = fallbackFile();
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* noop */
  }
}

async function read() {
  return (await readKeytar()) || readFallback();
}

async function write(payload) {
  const ok = await writeKeytar(payload);
  if (!ok) writeFallback(payload);
}

async function clear() {
  await deleteKeytar();
  deleteFallback();
}

module.exports = { read, write, clear };
