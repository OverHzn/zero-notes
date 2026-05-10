'use strict';

// SQLite persistence layer.
// All SQLite logic lives in the Electron main process — better-sqlite3 cannot
// be loaded in a sandboxed renderer, and it's also a security boundary.
//
// Schema:
//   notes(id TEXT PK, title TEXT, content TEXT, folder_id TEXT NULL,
//         tags TEXT (json array), is_pinned INT, created_at INT, updated_at INT,
//         deleted_at INT NULL, sync_status TEXT)
//   folders(id TEXT PK, name TEXT UNIQUE, created_at INT)
//
// Tags are stored as a JSON array on the row to keep the merge logic simple
// (the sync payload uses the same shape). A `tags_index` virtual table is not
// needed for the small note volume this app targets.

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const Database = require('better-sqlite3');
const { v4: uuid } = require('uuid');

let dbInstance = null;
let dbPath = null;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function getDbPath() {
  return dbPath;
}

function init() {
  const userData = app.getPath('userData');
  ensureDir(userData);
  dbPath = path.join(userData, 'zero-notes.sqlite');
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS folders_name_unique
      ON folders(name);

    CREATE TABLE IF NOT EXISTS notes (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL DEFAULT '',
      content      TEXT NOT NULL DEFAULT '',
      folder_id    TEXT NULL REFERENCES folders(id) ON DELETE SET NULL,
      tags         TEXT NOT NULL DEFAULT '[]',
      is_pinned    INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      deleted_at   INTEGER NULL,
      sync_status  TEXT NOT NULL DEFAULT 'pending_sync'
    );

    CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes(updated_at DESC);
    CREATE INDEX IF NOT EXISTS notes_folder_idx     ON notes(folder_id);
    CREATE INDEX IF NOT EXISTS notes_deleted_idx    ON notes(deleted_at);
    CREATE INDEX IF NOT EXISTS notes_sync_idx       ON notes(sync_status);
  `);

  return dbInstance;
}

function getDb() {
  if (!dbInstance) throw new Error('DB not initialised');
  return dbInstance;
}

// ---- Mapping ---------------------------------------------------------------

function rowToNote(row) {
  if (!row) return null;
  let tags = [];
  try {
    tags = row.tags ? JSON.parse(row.tags) : [];
    if (!Array.isArray(tags)) tags = [];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    folder_id: row.folder_id,
    tags,
    is_pinned: !!row.is_pinned,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    sync_status: row.sync_status,
  };
}

// ---- Folders ---------------------------------------------------------------

function listFolders() {
  return getDb()
    .prepare('SELECT id, name, created_at FROM folders ORDER BY name COLLATE NOCASE ASC')
    .all();
}

function createFolder(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Folder name required');
  const existing = getDb().prepare('SELECT id FROM folders WHERE name = ?').get(trimmed);
  if (existing) return getDb().prepare('SELECT * FROM folders WHERE id = ?').get(existing.id);
  const id = uuid();
  getDb()
    .prepare('INSERT INTO folders(id, name, created_at) VALUES (?, ?, ?)')
    .run(id, trimmed, Date.now());
  return getDb().prepare('SELECT * FROM folders WHERE id = ?').get(id);
}

function renameFolder(id, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Folder name required');
  getDb().prepare('UPDATE folders SET name = ? WHERE id = ?').run(trimmed, id);
  return getDb().prepare('SELECT * FROM folders WHERE id = ?').get(id);
}

function deleteFolder(id) {
  // SET NULL on notes.folder_id is handled by the FK ON DELETE clause.
  getDb().prepare('DELETE FROM folders WHERE id = ?').run(id);
  return { ok: true };
}

// ---- Notes -----------------------------------------------------------------

function listNotes(opts = {}) {
  const { folderId, tag, includeDeleted = false, search } = opts;
  const clauses = [];
  const params = [];
  if (!includeDeleted) clauses.push('deleted_at IS NULL');
  if (folderId === null) clauses.push('folder_id IS NULL');
  else if (folderId) {
    clauses.push('folder_id = ?');
    params.push(folderId);
  }
  if (search) {
    clauses.push('(title LIKE ? OR content LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `
    SELECT * FROM notes
    ${where}
    ORDER BY is_pinned DESC, updated_at DESC
  `;
  let rows = getDb().prepare(sql).all(...params).map(rowToNote);
  if (tag) rows = rows.filter((n) => n.tags.includes(tag));
  return rows;
}

function getNote(id) {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id);
  return rowToNote(row);
}

function createNote(partial = {}) {
  const id = partial.id || uuid();
  const now = Date.now();
  const note = {
    id,
    title: partial.title || '',
    content: partial.content || '',
    folder_id: partial.folder_id || null,
    tags: Array.isArray(partial.tags) ? partial.tags : [],
    is_pinned: partial.is_pinned ? 1 : 0,
    created_at: partial.created_at || now,
    updated_at: partial.updated_at || now,
    deleted_at: partial.deleted_at || null,
    sync_status: 'pending_sync',
  };
  getDb()
    .prepare(
      `INSERT INTO notes(id, title, content, folder_id, tags, is_pinned,
                         created_at, updated_at, deleted_at, sync_status)
       VALUES (@id, @title, @content, @folder_id, @tagsJson, @is_pinned,
               @created_at, @updated_at, @deleted_at, @sync_status)`
    )
    .run({ ...note, tagsJson: JSON.stringify(note.tags) });
  return getNote(id);
}

function updateNote(id, patch = {}) {
  const existing = getNote(id);
  if (!existing) throw new Error(`Note ${id} not found`);
  const next = {
    title: patch.title !== undefined ? patch.title : existing.title,
    content: patch.content !== undefined ? patch.content : existing.content,
    folder_id: patch.folder_id !== undefined ? patch.folder_id : existing.folder_id,
    tags: Array.isArray(patch.tags) ? patch.tags : existing.tags,
    is_pinned: patch.is_pinned !== undefined ? (patch.is_pinned ? 1 : 0) : existing.is_pinned ? 1 : 0,
    updated_at: Date.now(),
  };
  getDb()
    .prepare(
      `UPDATE notes
         SET title = @title,
             content = @content,
             folder_id = @folder_id,
             tags = @tagsJson,
             is_pinned = @is_pinned,
             updated_at = @updated_at,
             sync_status = 'pending_sync'
       WHERE id = @id`
    )
    .run({ ...next, tagsJson: JSON.stringify(next.tags), id });
  return getNote(id);
}

function softDeleteNote(id) {
  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE notes
         SET deleted_at = ?, updated_at = ?, sync_status = 'pending_sync'
       WHERE id = ?`
    )
    .run(now, now, id);
  return getNote(id);
}

function togglePin(id) {
  const existing = getNote(id);
  if (!existing) throw new Error(`Note ${id} not found`);
  return updateNote(id, { is_pinned: !existing.is_pinned });
}

function searchNotes(query) {
  return listNotes({ search: query });
}

function listTags() {
  const rows = getDb().prepare('SELECT tags FROM notes WHERE deleted_at IS NULL').all();
  const counts = new Map();
  for (const r of rows) {
    let arr = [];
    try {
      arr = JSON.parse(r.tags);
    } catch {
      arr = [];
    }
    if (!Array.isArray(arr)) continue;
    for (const t of arr) {
      if (!t) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Sync helpers ----------------------------------------------------------

function getPendingSyncNotes() {
  return getDb()
    .prepare("SELECT * FROM notes WHERE sync_status = 'pending_sync'")
    .all()
    .map(rowToNote);
}

function getAllNotesForSync() {
  // Includes soft-deleted rows so the sync payload represents tombstones.
  return getDb().prepare('SELECT * FROM notes').all().map(rowToNote);
}

function markAllSynced() {
  getDb()
    .prepare("UPDATE notes SET sync_status = 'synced' WHERE sync_status = 'pending_sync'")
    .run();
}

function upsertNoteFromSync(note) {
  const existing = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
  const tagsJson = JSON.stringify(Array.isArray(note.tags) ? note.tags : []);
  if (!existing) {
    getDb()
      .prepare(
        `INSERT INTO notes(id, title, content, folder_id, tags, is_pinned,
                           created_at, updated_at, deleted_at, sync_status)
         VALUES (@id, @title, @content, @folder_id, @tagsJson, @is_pinned,
                 @created_at, @updated_at, @deleted_at, 'synced')`
      )
      .run({
        id: note.id,
        title: note.title || '',
        content: note.content || '',
        folder_id: note.folder_id || null,
        tagsJson,
        is_pinned: note.is_pinned ? 1 : 0,
        created_at: note.created_at || Date.now(),
        updated_at: note.updated_at || Date.now(),
        deleted_at: note.deleted_at || null,
      });
  } else {
    getDb()
      .prepare(
        `UPDATE notes
            SET title = @title,
                content = @content,
                folder_id = @folder_id,
                tags = @tagsJson,
                is_pinned = @is_pinned,
                created_at = @created_at,
                updated_at = @updated_at,
                deleted_at = @deleted_at,
                sync_status = 'synced'
          WHERE id = @id`
      )
      .run({
        id: note.id,
        title: note.title || '',
        content: note.content || '',
        folder_id: note.folder_id || null,
        tagsJson,
        is_pinned: note.is_pinned ? 1 : 0,
        created_at: note.created_at || Date.now(),
        updated_at: note.updated_at || Date.now(),
        deleted_at: note.deleted_at || null,
      });
  }
}

function ensureFolderByName(name) {
  if (!name) return null;
  const existing = getDb().prepare('SELECT id FROM folders WHERE name = ?').get(name);
  if (existing) return existing.id;
  const id = uuid();
  getDb()
    .prepare('INSERT INTO folders(id, name, created_at) VALUES (?, ?, ?)')
    .run(id, name, Date.now());
  return id;
}

module.exports = {
  init,
  getDb,
  getDbPath,
  // notes
  listNotes,
  getNote,
  createNote,
  updateNote,
  softDeleteNote,
  togglePin,
  searchNotes,
  // folders
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  ensureFolderByName,
  // tags
  listTags,
  // sync
  getPendingSyncNotes,
  getAllNotesForSync,
  markAllSynced,
  upsertNoteFromSync,
};
