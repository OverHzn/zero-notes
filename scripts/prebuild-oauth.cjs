#!/usr/bin/env node
'use strict';

// prebuild-oauth.cjs
//
// Bake the Google OAuth Desktop client credentials into the packaged app so
// the installer ships ready-to-use — end users install, click "Login with
// Google", and the system browser opens straight to Google's account picker.
//
// Run automatically before `npm run dist` via the `predist` lifecycle hook.
//
// Inputs (env vars):
//   ZN_GOOGLE_CLIENT_ID      — e.g. xxxxx.apps.googleusercontent.com
//   ZN_GOOGLE_CLIENT_SECRET  — e.g. GOCSPX-xxxxx
//
// Output:
//   electron/oauth-config.bundled.json
//
// The file is .gitignored so the secret never enters source control. If the
// env vars aren't set we still write an empty stub so the asar packer always
// has the file to bundle (and `electron/oauth-config.js` cleanly falls back
// to the env-var / userData paths at runtime).
//
// Per Google's own docs, the client_secret for a *Desktop* OAuth client is
// not considered a real secret — it's designed to be bundled with
// distributed desktop apps. We still avoid checking it into git as a basic
// hygiene measure.

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = path.resolve(__dirname, '..', 'electron', 'oauth-config.bundled.json');

const clientId = process.env.ZN_GOOGLE_CLIENT_ID || '';
const clientSecret = process.env.ZN_GOOGLE_CLIENT_SECRET || '';

const payload =
  clientId && clientSecret
    ? { client_id: clientId, client_secret: clientSecret }
    : {};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + '\n', {
  mode: 0o600,
});

if (clientId && clientSecret) {
  // Print the client_id (it's not a secret) so build logs make the wiring
  // visible; never print the client_secret.
  console.log(
    `[zero-notes] bundled OAuth credentials baked into ${path.relative(process.cwd(), OUTPUT)} (client_id ${clientId.slice(0, 16)}…)`
  );
} else {
  console.log(
    '[zero-notes] ZN_GOOGLE_CLIENT_ID / ZN_GOOGLE_CLIENT_SECRET not set — installer will require users to provide their own credentials (env vars or Settings UI).'
  );
}
