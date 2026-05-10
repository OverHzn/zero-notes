# Zero Notes

A local-first **Windows desktop note-taking app** built with **Electron + React + Vite + SQLite**, with hidden cloud sync to Google Drive's `appDataFolder` — a per-app sandbox that's invisible from your normal Drive UI.

Local SQLite is the source of truth. Google Drive is **only** used for syncing across your own machines. The app uses the **minimum** Drive scope possible: `https://www.googleapis.com/auth/drive.appdata`. It cannot read, list, or modify any other file in your Drive.

---

## Features

- **Notes**: create, edit, delete (soft-delete with `deleted_at`), search, pin
- **Folders** and **tags**
- **Auto-save** with configurable debounce
- **Dark / light theme** (defaults to dark)
- **Local SQLite** database (`better-sqlite3`) in your OS user-data directory
- **Secure Electron** with `contextIsolation` on, `nodeIntegration` off, and a small preload bridge (`window.zeroNotes`)
- **Google OAuth 2.0 — Desktop App flow** (loopback redirect; system browser opens for sign-in — Zero Notes never sees your Google password)
- **Google Drive `appDataFolder` sync** of a single hidden file: `zeronotes-sync.json`
- **Last-write-wins** merge by default, with optional **"Conflict Copy"** strategy
- **Optional client-side AES-256-GCM encryption** of the cloud payload
- **OS keychain** token storage (`keytar`) with `safeStorage` fallback
- **Auto-sync triggers**: on app start, on "Sync Now", every 3 minutes, and on close
- **Single-instance lock** so two windows never fight over the same DB
- **Windows installer** via `electron-builder` (`npm run dist`)

---

## Folder structure

```
zero-notes/
├── electron/                # Electron main process (CommonJS)
│   ├── main.js              # window, IPC routing, app lifecycle
│   ├── preload.js           # secure bridge → window.zeroNotes
│   ├── db.js                # better-sqlite3: notes, folders, tags
│   ├── settings.js          # electron-store user prefs
│   ├── device.js            # stable per-install device id
│   ├── tokens.js            # keytar + safeStorage token vault
│   ├── oauth-config.js      # loads Google OAuth client_id/secret
│   ├── google-auth.js       # OAuth 2.0 Desktop flow (loopback redirect)
│   ├── google-drive.js      # Drive appDataFolder operations
│   ├── crypto.js            # optional AES-256-GCM encryption
│   └── sync.js              # merge logic, conflict resolution, triggers
├── src/                     # React renderer (TypeScript + Vite)
│   ├── App.tsx
│   ├── api.ts
│   ├── types.ts
│   ├── util.ts
│   ├── styles.css
│   └── components/
│       ├── TopBar.tsx
│       ├── Sidebar.tsx
│       ├── NoteList.tsx
│       ├── Editor.tsx
│       ├── Settings.tsx
│       └── SyncBadge.tsx
├── index.html               # Vite entry
├── vite.config.ts
├── tsconfig.json
├── package.json             # includes electron-builder config
└── .gitignore
```

---

## 1. Install

Requires **Node.js 18+** and Windows build tools (for native modules).

```bash
git clone https://github.com/OverHzn/zero-notes.git
cd zero-notes
npm install
```

> The `postinstall` step runs `electron-builder install-app-deps` to rebuild native modules (`better-sqlite3`, `keytar`) against Electron's bundled Node.

---

## 2. Set up Google OAuth (Desktop client)

You need a **Desktop App** OAuth client from Google Cloud Console. This is one-time, ~3 minutes.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → set up an "External" app (skip if you already have one). Add `.../auth/drive.appdata` and the basic profile/email scopes if asked.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Desktop app**
   - Name: `Zero Notes (desktop)`
5. Copy the **Client ID** and **Client secret**. (Google's docs note that for installed/desktop apps, the client secret is not actually treated as confidential, but we still avoid checking it into source control.)
6. Provide them to Zero Notes in any one of these ways:

   - **Recommended (dev)**: create `.env` next to `package.json`:

     ```env
     ZN_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
     ZN_GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
     ```

     and run dev as `cross-env $(cat .env | xargs) npm run dev` — or just export them in your shell.

   - **Recommended (installed app)**: drop a JSON file at
     `%APPDATA%/Zero Notes/oauth-config.json` containing either Google's downloaded format:

     ```json
     {
       "installed": {
         "client_id": "xxxxx.apps.googleusercontent.com",
         "client_secret": "GOCSPX-xxxxxxxx"
       }
     }
     ```

     or our short form:

     ```json
     {
       "client_id": "xxxxx.apps.googleusercontent.com",
       "client_secret": "GOCSPX-xxxxxxxx"
     }
     ```

7. (Optional) **Test users**: while your OAuth consent screen is in "Testing" mode, add yourself under "Test users", or publish the app.

> **Why only `drive.appdata`?** This scope confines us to a hidden per-app folder. Zero Notes literally cannot see your other Drive files — even if there were a bug.

---

## 3. Run in development

```bash
npm run dev
```

This starts:

- **Vite** on http://localhost:5173 (renderer hot-reload)
- **Electron** loading that URL with the dev preload bridge

`Ctrl+N` creates a new note. `Ctrl+Shift+S` syncs immediately.

---

## 4. Build a Windows installer

```bash
npm run dist
```

Produces `release/Zero Notes-Setup-<version>.exe` (NSIS installer; per-user, lets the user pick install dir, creates Start-menu and desktop shortcuts).

For an unpacked build (no installer):

```bash
npm run dist:dir
```

---

## How sync works

1. The app sees a local change → marks the note as `pending_sync`, writes it to SQLite.
2. On a sync trigger (startup / "Sync Now" / every 3 min / before quit):
   1. Find `zeronotes-sync.json` in `appDataFolder` via
      `drive.files.list({ spaces: 'appDataFolder', q: "name = 'zeronotes-sync.json'" })`.
   2. Download it (`alt: 'media'`).
   3. If the payload is encrypted (`ZN-ENC-v1:…`), decrypt with the user's local passphrase.
   4. Read all local notes from SQLite and merge by `id`:
      - Newer `updated_at` wins.
      - With **"Conflict Copy"** strategy, if both sides changed since the last sync, we keep the local version AND add a duplicate of the remote with `(Conflict Copy)` appended to the title.
   5. Write the merged result back into SQLite.
   6. Re-serialise SQLite → JSON, optionally encrypt, and `files.update()` the existing file (or `files.create({ parents: ['appDataFolder'] })` if it didn't exist yet).
   7. Mark all local notes as `synced`.
3. On error or no auth, the sync silently no-ops and the UI shows `Offline` / `Sync error` in the top bar.

The full payload schema (see `electron/sync.js → buildLocalPayload()`):

```json
{
  "schema": "zero-notes/sync",
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "deviceId": "<uuid>",
  "lastSyncAt": 1700000000000,
  "notes": [
    {
      "id": "<uuid>",
      "title": "...",
      "content": "...",
      "folder_id": "<uuid|null>",
      "tags": ["..."],
      "is_pinned": false,
      "created_at": 1700000000000,
      "updated_at": 1700000000000,
      "deleted_at": null,
      "sync_status": "synced"
    }
  ],
  "folders": [{ "id": "<uuid>", "name": "...", "created_at": 1700000000000 }]
}
```

---

## Security notes

- **No `drive` or `drive.file` scope** — only `drive.appdata`.
- **System browser** is used for OAuth; the Electron window never embeds Google's login form.
- **`contextIsolation: true`**, **`nodeIntegration: false`**, with a tiny preload bridge.
- **OS keychain** stores the OAuth tokens (`keytar`); on systems without a keychain we fall back to Electron's `safeStorage`-encrypted file.
- **Optional AES-256-GCM** encryption of the sync payload before upload. The passphrase is stored locally only.
- Strict **CSP** on the renderer (`default-src 'self'`).
- All in-renderer navigation is blocked; external links open in the OS browser.

---

## Scripts

| Command            | What it does                                       |
| ------------------ | -------------------------------------------------- |
| `npm run dev`      | Vite + Electron in dev mode (HMR for the renderer) |
| `npm run build`    | Build the renderer to `dist/`                      |
| `npm run start`    | Run Electron against the built `dist/`             |
| `npm run lint`     | ESLint over JS/TS/TSX                              |
| `npm run typecheck`| `tsc --noEmit`                                     |
| `npm run dist`     | Build + package Windows NSIS installer             |
| `npm run dist:dir` | Build + unpacked Windows directory                 |

---

## License

MIT
