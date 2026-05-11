'use strict';

// Stable device id per Zero Notes installation.
// Stored alongside settings (config.json) so the same install always reports
// the same id in the sync payload, but reinstalls / new machines look distinct.

const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const { v4: uuid } = require('uuid');

let cached = null;

function getDeviceFile() {
  return path.join(app.getPath('userData'), 'device.json');
}

function getDeviceId() {
  if (cached) return cached;
  const file = getDeviceFile();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.deviceId === 'string') {
      cached = parsed.deviceId;
      return cached;
    }
  } catch {
    // fall through and create a new one
  }
  const id = uuid();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ deviceId: id, createdAt: Date.now() }, null, 2));
  cached = id;
  return id;
}

module.exports = { getDeviceId };
