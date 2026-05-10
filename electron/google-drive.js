'use strict';

// Google Drive appDataFolder operations.
//
// CRITICAL: every Drive call here uses `spaces: "appDataFolder"` and
// `parents: ["appDataFolder"]`. With the `drive.appdata` scope this means:
//   * The sync file is invisible in the user's normal Drive UI.
//   * Only this app (identified by its OAuth client_id) can see / read it.
//   * The user can wipe it via Drive's "Manage apps" settings.
//
// We never request `drive` or `drive.file`, so this app cannot touch any
// other file in the user's Drive — even if there were a bug.

const { Readable } = require('node:stream');
const { google } = require('googleapis');

const SYNC_FILENAME = 'zeronotes-sync.json';

function driveFor(authClient) {
  return google.drive({ version: 'v3', auth: authClient });
}

async function findSyncFile(authClient) {
  const drive = driveFor(authClient);
  const res = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name = '${SYNC_FILENAME}' and trashed = false`,
    fields: 'files(id, name, modifiedTime, size)',
    pageSize: 10,
  });
  const files = res.data.files || [];
  if (!files.length) return null;
  // If there are somehow multiple, pick the most recently modified.
  files.sort(
    (a, b) =>
      new Date(b.modifiedTime || 0).getTime() - new Date(a.modifiedTime || 0).getTime()
  );
  return files[0];
}

async function downloadSyncFile(authClient, fileId) {
  const drive = driveFor(authClient);
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );
  // googleapis returns the body as a string for alt=media + responseType=text.
  if (typeof res.data === 'string') return res.data;
  if (Buffer.isBuffer(res.data)) return res.data.toString('utf8');
  // Fallback: stringify whatever JSON object we got.
  return JSON.stringify(res.data);
}

async function createSyncFile(authClient, jsonString) {
  const drive = driveFor(authClient);
  const res = await drive.files.create({
    requestBody: {
      name: SYNC_FILENAME,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    },
    media: {
      mimeType: 'application/json',
      body: Readable.from([jsonString]),
    },
    fields: 'id, name, modifiedTime, size',
  });
  return res.data;
}

async function updateSyncFile(authClient, fileId, jsonString) {
  const drive = driveFor(authClient);
  const res = await drive.files.update({
    fileId,
    media: {
      mimeType: 'application/json',
      body: Readable.from([jsonString]),
    },
    fields: 'id, name, modifiedTime, size',
  });
  return res.data;
}

async function uploadSyncFile(authClient, jsonString) {
  const existing = await findSyncFile(authClient);
  if (existing) return updateSyncFile(authClient, existing.id, jsonString);
  return createSyncFile(authClient, jsonString);
}

module.exports = {
  SYNC_FILENAME,
  findSyncFile,
  downloadSyncFile,
  uploadSyncFile,
  createSyncFile,
  updateSyncFile,
};
