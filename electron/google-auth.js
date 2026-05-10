'use strict';

// Google OAuth 2.0 — Desktop App flow with loopback redirect.
//
// Flow:
//   1. Start an ephemeral http server on 127.0.0.1:<random_port>.
//   2. Build the Google authorization URL with redirect_uri pointing at the
//      loopback server, and open it in the user's default browser via
//      shell.openExternal — we never embed Google's login UI in our own
//      window (per Google's policy and basic security hygiene).
//   3. Google redirects back to http://127.0.0.1:<port>/callback?code=... with
//      the authorization code.
//   4. We exchange the code for { access_token, refresh_token, expiry_date }
//      via the googleapis OAuth2 client, fetch the user profile (userinfo
//      endpoint via the openid/profile/email scopes) and store everything
//      through `tokens.write()`.
//
// Scopes (minimum):
//   * openid + profile + email — so we can show "logged in as <email>"
//   * https://www.googleapis.com/auth/drive.appdata — hidden appDataFolder
//                                                    sync only. NEVER request
//                                                    drive or drive.file.

const http = require('node:http');
const url = require('node:url');
const crypto = require('node:crypto');
const { shell } = require('electron');
const { google } = require('googleapis');

const tokens = require('./tokens');
const oauthConfig = require('./oauth-config');

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.appdata',
];

function buildOAuthClient(redirectUri) {
  const cfg = oauthConfig.load();
  if (!cfg) {
    const err = new Error(
      'Google OAuth client is not configured. Open Settings → Account → "Configure Google OAuth" or set ZN_GOOGLE_CLIENT_ID / ZN_GOOGLE_CLIENT_SECRET.'
    );
    err.code = 'OAUTH_NOT_CONFIGURED';
    throw err;
  }
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, redirectUri);
}

function startLoopbackServer(state) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const codePromise = new Promise((res, rej) => {
        server.on('request', (req, response) => {
          try {
            const parsed = url.parse(req.url, true);
            if (parsed.pathname !== '/callback') {
              response.statusCode = 404;
              response.end();
              return;
            }
            const { code, state: returnedState, error } = parsed.query;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            if (error) {
              response.statusCode = 400;
              response.end(htmlPage(`Authorization failed: ${escapeHtml(String(error))}`, false));
              rej(new Error(`Google authorization failed: ${error}`));
              return;
            }
            if (returnedState !== state) {
              response.statusCode = 400;
              response.end(htmlPage('State mismatch — possible CSRF. Aborting.', false));
              rej(new Error('OAuth state mismatch'));
              return;
            }
            if (!code) {
              response.statusCode = 400;
              response.end(htmlPage('Missing authorization code.', false));
              rej(new Error('Missing authorization code'));
              return;
            }
            response.statusCode = 200;
            response.end(
              htmlPage(
                'You can close this tab and return to Zero Notes — your account is now connected.',
                true
              )
            );
            res(code);
          } catch (e) {
            rej(e);
          } finally {
            // Close after a short delay so the browser actually receives the
            // response body before the socket dies. `loginInteractive` also
            // closes the server in its own finally block, so guard against the
            // already-closed case to avoid an unhandled ERR_SERVER_NOT_RUNNING.
            setTimeout(() => {
              try {
                server.close();
              } catch {
                /* server already closed */
              }
            }, 250);
          }
        });
      });

      resolve({ redirectUri, codePromise, close: () => server.close() });
    });
  });
}

function htmlPage(message, success) {
  const color = success ? '#3ecf8e' : '#ff6b6b';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Zero Notes</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8e8ec;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#181b22;border:1px solid #232733;border-radius:14px;padding:32px 36px;
        max-width:480px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.4)}
  .badge{display:inline-block;width:48px;height:48px;border-radius:50%;background:${color};
         margin-bottom:16px;display:flex;align-items:center;justify-content:center;color:#0f1115;
         font-weight:700;font-size:22px;line-height:48px;margin-left:auto;margin-right:auto}
  h1{margin:0 0 8px;font-size:18px}
  p{margin:0;color:#a8acba;line-height:1.5}
</style></head>
<body><div class="card"><div class="badge">${success ? '\u2713' : '!'}</div>
<h1>Zero Notes</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchProfile(oauth2Client) {
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  try {
    const { data } = await oauth2.userinfo.get();
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      picture: data.picture,
      verified_email: data.verified_email,
    };
  } catch (err) {
    console.warn('[zero-notes] failed to fetch userinfo', err.message);
    return {};
  }
}

async function loginInteractive() {
  const state = crypto.randomBytes(16).toString('hex');
  const server = await startLoopbackServer(state);
  const oauth2Client = buildOAuthClient(server.redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token issuance
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });

  // Open the system browser — never embed Google login in our own window.
  await shell.openExternal(authUrl);

  let code;
  try {
    code = await server.codePromise;
  } finally {
    try {
      server.close();
    } catch {
      /* The request handler may have already closed the server. */
    }
  }

  const { tokens: tok } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tok);

  const profile = await fetchProfile(oauth2Client);

  const payload = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expiry_date: tok.expiry_date,
    scope: tok.scope,
    token_type: tok.token_type,
    id_token: tok.id_token,
    profile,
  };

  await tokens.write(payload);

  return {
    connected: true,
    email: profile.email || null,
    name: profile.name || null,
    picture: profile.picture || null,
    tokenExpiry: tok.expiry_date || null,
  };
}

async function logout() {
  const stored = await tokens.read();
  if (stored) {
    try {
      const oauth2Client = buildOAuthClient('http://127.0.0.1');
      oauth2Client.setCredentials(stored);
      // Best-effort revoke; ignore failures.
      if (stored.refresh_token) {
        await oauth2Client.revokeToken(stored.refresh_token).catch(() => {});
      } else if (stored.access_token) {
        await oauth2Client.revokeToken(stored.access_token).catch(() => {});
      }
    } catch {
      /* OAuth client may not be configured — that's fine, we still clear local tokens. */
    }
  }
  await tokens.clear();
}

// Returns an authenticated googleapis OAuth2 client, refreshing the access
// token automatically as needed and persisting the refreshed value back to
// the secure store.
async function getAuthenticatedClient() {
  const stored = await tokens.read();
  if (!stored || !stored.refresh_token) return null;

  const oauth2Client = buildOAuthClient('http://127.0.0.1');
  oauth2Client.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expiry_date: stored.expiry_date,
    scope: stored.scope,
    token_type: stored.token_type,
    id_token: stored.id_token,
  });

  oauth2Client.on('tokens', (newTokens) => {
    const merged = { ...stored, ...newTokens };
    // googleapis emits the refresh_token only on the very first exchange, so
    // preserve the existing one across refreshes.
    if (!newTokens.refresh_token && stored.refresh_token) {
      merged.refresh_token = stored.refresh_token;
    }
    tokens.write(merged).catch((err) => {
      console.warn('[zero-notes] failed to persist refreshed tokens', err);
    });
  });

  return oauth2Client;
}

function isConfigured() {
  return oauthConfig.isConfigured();
}

module.exports = {
  loginInteractive,
  logout,
  getAuthenticatedClient,
  isConfigured,
  SCOPES,
};
