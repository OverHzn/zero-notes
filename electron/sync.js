'use strict';

// appDataFolder sync orchestration.
//
// Sync algorithm (per the project spec):
//   1. Download zeronotes-sync.json from appDataFolder.
//   2. Read the local SQLite into the same JSON shape.
//   3. Merge by note id:
//        - Compare updated_at timestamps (last-write-wins for v1).
//        - If both sides changed since the last sync (conflict), default
//          strategy is last-write-wins; with the optional
//          "duplicate-on-conflict" strategy we keep the local copy AND
//          create a "<title> (Conflict Copy)" duplicate of the remote.
//   4. Upload the merged JSON back to appDataFolder.
//   5. Mark all local notes as synced.
//
// The status state machine is simple:
//   "offline" → "syncing" → ("synced" | "error") and is broadcast to the
//   renderer over the `sync:status` IPC event so the top bar can update.

const googleAuth = require('./google-auth');
const cryptoLayer = require('./crypto');

const SYNC_VERSION = 1;
const APP_VERSION = '1.0.0';

let dbRef = null;
let driveRef = null;
let settingsRef = null;
let deviceRef = null;
let broadcastFn = () => {};

let status = {
  state: 'offline',          // offline | syncing | synced | error
  lastSyncAt: null,
  lastError: null,
  lastTrigger: null,
  conflictsLastRun: 0,
};

let inFlight = null;
let shutdownDone = false;

function init(deps) {
  dbRef = deps.db;
  driveRef = deps.googleDrive;
  settingsRef = deps.settings;
  deviceRef = deps.device;
  if (typeof deps.broadcast === 'function') broadcastFn = deps.broadcast;
}

function setStatus(patch) {
  status = { ...status, ...patch };
  broadcastFn('sync:status', status);
}

function getStatus() {
  return status;
}

function isShutdownSyncDone() {
  return shutdownDone;
}

function markShutdownSyncDone() {
  shutdownDone = true;
}

function buildLocalPayload() {
  const notes = dbRef.getAllNotesForSync().map((n) => ({
    id: n.id,
    title: n.title,
    content: n.content,
    folder_id: n.folder_id,
    tags: n.tags,
    is_pinned: !!n.is_pinned,
    created_at: n.created_at,
    updated_at: n.updated_at,
    deleted_at: n.deleted_at,
    sync_status: 'synced',
  }));

  const folders = dbRef.listFolders().map((f) => ({
    id: f.id,
    name: f.name,
    created_at: f.created_at,
  }));

  return {
    schema: 'zero-notes/sync',
    schemaVersion: SYNC_VERSION,
    appVersion: APP_VERSION,
    deviceId: deviceRef.getDeviceId(),
    lastSyncAt: Date.now(),
    notes,
    folders,
  };
}

// pickWinner returns `winner` ('local' | 'remote' | 'tie') and `conflict`.
//
// A *true* conflict requires both sides to have changed since the last
// successful sync — not merely that their `updated_at` timestamps differ.
// Without `lastSyncAt` we can't be sure, so we conservatively treat any
// disagreement as a conflict (preserving v1 behavior). When `lastSyncAt` is
// known, only notes whose `updated_at > lastSyncAt` on BOTH sides are flagged
// as conflicts; otherwise we silently let the newer side win.
function pickWinner(localNote, remoteNote, lastSyncAt) {
  const lu = localNote.updated_at || 0;
  const ru = remoteNote.updated_at || 0;
  if (lu === ru) return { winner: 'tie', conflict: false };

  let conflict;
  if (typeof lastSyncAt === 'number' && lastSyncAt > 0) {
    conflict = lu > lastSyncAt && ru > lastSyncAt;
  } else {
    conflict = true;
  }

  if (lu > ru) return { winner: 'local', conflict };
  return { winner: 'remote', conflict };
}

function mergeNotes(local, remote, strategy, lastSyncAt) {
  // Build maps keyed by id.
  const byId = new Map();
  for (const n of local) byId.set(n.id, { local: n, remote: null });
  for (const n of remote) {
    const slot = byId.get(n.id) || { local: null, remote: null };
    slot.remote = n;
    byId.set(n.id, slot);
  }

  const merged = [];
  let conflicts = 0;

  for (const [, { local: l, remote: r }] of byId) {
    if (l && !r) {
      merged.push(l);
      continue;
    }
    if (!l && r) {
      merged.push(r);
      continue;
    }
    const { winner, conflict } = pickWinner(l, r, lastSyncAt);
    if (conflict) conflicts += 1;

    if (winner === 'tie') {
      merged.push(l);
    } else if (winner === 'local') {
      merged.push(l);
      if (conflict && strategy === 'duplicate-on-conflict' && r && !r.deleted_at) {
        merged.push({
          ...r,
          id: `${r.id}-conflict-${Date.now()}`,
          title: `${r.title || 'Untitled'} (Conflict Copy)`,
          created_at: Date.now(),
          updated_at: Date.now(),
          sync_status: 'synced',
        });
      }
    } else {
      merged.push(r);
      if (conflict && strategy === 'duplicate-on-conflict' && l && !l.deleted_at) {
        merged.push({
          ...l,
          id: `${l.id}-conflict-${Date.now()}`,
          title: `${l.title || 'Untitled'} (Conflict Copy)`,
          created_at: Date.now(),
          updated_at: Date.now(),
          sync_status: 'synced',
        });
      }
    }
  }
  return { merged, conflicts };
}

function mergeFolders(local, remote) {
  const byName = new Map();
  for (const f of local) byName.set(f.name, f);
  for (const f of remote) if (!byName.has(f.name)) byName.set(f.name, f);
  return [...byName.values()];
}

async function runOnce({ trigger = 'manual' } = {}) {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    setStatus({ state: 'syncing', lastTrigger: trigger, lastError: null });

    const settings = settingsRef.getAll();
    if (!settings.syncEnabled) {
      setStatus({ state: 'offline', lastError: null });
      return { ok: false, skipped: true, reason: 'sync_disabled' };
    }

    const authClient = await googleAuth.getAuthenticatedClient();
    if (!authClient) {
      setStatus({ state: 'offline', lastError: null });
      return { ok: false, skipped: true, reason: 'not_signed_in' };
    }

    try {
      // 1. Download remote.
      let remoteParsed = null;
      const file = await driveRef.findSyncFile(authClient);
      if (file) {
        const raw = await driveRef.downloadSyncFile(authClient, file.id);
        let text = raw;
        if (cryptoLayer.isEncrypted(raw)) {
          if (!settings.encryptCloudSync || !settings.encryptionPassphrase) {
            throw new Error(
              'Remote sync file is encrypted but encryption is disabled or passphrase is not set.'
            );
          }
          text = cryptoLayer.decrypt(raw, settings.encryptionPassphrase);
        }
        try {
          remoteParsed = JSON.parse(text);
        } catch {
          throw new Error('Remote zeronotes-sync.json is not valid JSON');
        }
      }

      // 2. Build local payload from SQLite.
      const localPayload = buildLocalPayload();

      // 3. Merge.
      let mergedNotes = localPayload.notes;
      let mergedFolders = localPayload.folders;
      let conflicts = 0;

      if (remoteParsed && Array.isArray(remoteParsed.notes)) {
        // Use the timestamp that *the remote payload* recorded as its last
        // successful sync. Notes whose updated_at exceeds this value have
        // changed since the last sync and are eligible for conflict flagging.
        const lastSyncAt =
          typeof remoteParsed.lastSyncAt === 'number' ? remoteParsed.lastSyncAt : 0;
        const result = mergeNotes(
          localPayload.notes,
          remoteParsed.notes,
          settings.conflictStrategy || 'last-write-wins',
          lastSyncAt
        );
        mergedNotes = result.merged;
        conflicts = result.conflicts;
      }
      if (remoteParsed && Array.isArray(remoteParsed.folders)) {
        mergedFolders = mergeFolders(localPayload.folders, remoteParsed.folders);
      }

      // 4. Apply merged result back to SQLite (upsert + ensure folders).
      const folderNameToId = new Map();
      for (const f of mergedFolders) {
        const id = dbRef.ensureFolderByName(f.name);
        folderNameToId.set(f.name, id);
      }

      for (const note of mergedNotes) {
        // Translate folder_id if the remote used a different folder uuid for
        // the same folder name.
        if (note.folder_id && remoteParsed && Array.isArray(remoteParsed.folders)) {
          const remoteFolder = remoteParsed.folders.find((f) => f.id === note.folder_id);
          if (remoteFolder && folderNameToId.has(remoteFolder.name)) {
            note.folder_id = folderNameToId.get(remoteFolder.name);
          }
        }
        dbRef.upsertNoteFromSync(note);
      }
      dbRef.markAllSynced();

      // 5. Build upload payload from the now-canonical local DB and upload.
      const uploadPayload = buildLocalPayload();
      let toUpload = JSON.stringify(uploadPayload, null, 2);
      if (settings.encryptCloudSync) {
        const passphrase = settings.encryptionPassphrase;
        if (!passphrase) {
          throw new Error(
            'Encrypted cloud sync is enabled but no passphrase is set. Open Settings → Sync to set one.'
          );
        }
        toUpload = cryptoLayer.encrypt(toUpload, passphrase);
      }
      await driveRef.uploadSyncFile(authClient, toUpload);

      const lastSyncAt = Date.now();
      setStatus({
        state: 'synced',
        lastSyncAt,
        lastError: null,
        conflictsLastRun: conflicts,
      });
      return { ok: true, lastSyncAt, conflicts };
    } catch (err) {
      console.error('[zero-notes] sync failed', err);
      setStatus({
        state: 'error',
        lastError: err.message || String(err),
      });
      return { ok: false, error: err.message || String(err) };
    }
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = {
  init,
  runOnce,
  getStatus,
  isShutdownSyncDone,
  markShutdownSyncDone,
};
