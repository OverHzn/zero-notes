'use strict';

// Loads the Google OAuth client credentials.
//
// We look in two places, in order:
//   1. <userData>/oauth-config.json — written by the user via Settings UI or
//      manually placed alongside the app data folder.
//   2. ZN_GOOGLE_CLIENT_ID + ZN_GOOGLE_CLIENT_SECRET environment variables —
//      useful for `npm run dev` so contributors don't need to bake credentials
//      into the repo.
//
// We deliberately do NOT bundle a client_secret with the app source. Each
// installer build is expected to either:
//   * ship a client_secret.json next to the executable (recommended for
//     small/personal builds), or
//   * have the user paste their Client ID + Secret into Settings on first
//     launch.
//
// The OAuth Desktop App flow does not treat the client secret as truly secret
// — Google explicitly states this in their docs — but we still avoid checking
// it into source control.

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

function load() {
  return readFromDisk() || readFromEnv();
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
