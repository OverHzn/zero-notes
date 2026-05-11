'use strict';

// Loads the Google OAuth client credentials.
//
// We look in three places, in order:
//   1. <userData>/oauth-config.json — per-user override written via the
//      Settings UI or manually placed alongside the app data folder. Takes
//      precedence so power users can swap in their own OAuth client.
//   2. ZN_GOOGLE_CLIENT_ID + ZN_GOOGLE_CLIENT_SECRET environment variables —
//      used during `npm run dev` so contributors don't need to bake
//      credentials into a build.
//   3. electron/oauth-config.bundled.json — written by scripts/prebuild-oauth.cjs
//      before `npm run dist` from the same env vars. This is what makes the
//      installer "click Login with Google → done" with no setup required by
//      the end user. The file is .gitignored so the value never enters source.
//
// Per Google's docs, the client_secret for a *Desktop* OAuth client is not a
// real secret — it's designed to be embedded in distributed desktop apps —
// so bundling it is fine for this flow. (drive.file or web flows are
// different.)

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

function configPath() {
  return path.join(app.getPath('userData'), 'oauth-config.json');
}

function readFromDisk() {
  const file = configPath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);

    // Support both Google's downloaded-from-console format and our own
    // simpler { client_id, client_secret } format.
    const installed = parsed.installed || parsed.web;
    if (installed && installed.client_id && installed.client_secret) {
      return {
        clientId: installed.client_id,
        clientSecret: installed.client_secret,
      };
    }
    if (parsed.client_id && parsed.client_secret) {
      return {
        clientId: parsed.client_id,
        clientSecret: parsed.client_secret,
      };
    }
  } catch (err) {
    console.warn('[zero-notes] failed to parse oauth-config.json', err);
  }
  return null;
}

function readFromEnv() {
  const clientId = process.env.ZN_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.ZN_GOOGLE_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret };
  return null;
}

function readFromBundle() {
  // electron/oauth-config.bundled.json lives next to this file. In production
  // builds it's inside app.asar, which fs and require handle transparently.
  const file = path.join(__dirname, 'oauth-config.bundled.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.client_id && parsed.client_secret) {
      return {
        clientId: parsed.client_id,
        clientSecret: parsed.client_secret,
      };
    }
  } catch {
    // File missing or empty stub — that's normal for fresh checkouts.
  }
  return null;
}

function load() {
  return readFromDisk() || readFromEnv() || readFromBundle();
}

function save({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) {
    throw new Error('clientId and clientSecret are required');
  }
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ client_id: clientId, client_secret: clientSecret }, null, 2),
    { mode: 0o600 }
  );
}

function isConfigured() {
  return !!load();
}

function getConfigPath() {
  return configPath();
}

module.exports = { load, save, isConfigured, getConfigPath };
