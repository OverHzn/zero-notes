import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppMeta, AppSettings, AuthStatus, SyncStatus } from '../types';
import { formatTimestamp } from '../util';

interface Props {
  authStatus: AuthStatus;
  syncStatus: SyncStatus;
  settings: AppSettings;
  meta: AppMeta | null;
  onClose: () => void;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}

export function Settings({
  authStatus,
  syncStatus,
  settings,
  meta,
  onClose,
  onLogin,
  onLogout,
  onSyncNow,
  onUpdateSetting,
}: Props) {
  const [tab, setTab] = useState<'account' | 'sync' | 'storage'>('account');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busyLogin, setBusyLogin] = useState(false);
  const [passphrase, setPassphrase] = useState<string>(
    settings.encryptionPassphrase || ''
  );
  const [revealPass, setRevealPass] = useState(false);

  useEffect(() => {
    setPassphrase(settings.encryptionPassphrase || '');
  }, [settings.encryptionPassphrase]);

  const handleLogin = async () => {
    setBusyLogin(true);
    setLoginError(null);
    try {
      await onLogin();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setLoginError(msg);
    } finally {
      setBusyLogin(false);
    }
  };

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-shell">
        <header className="settings-header">
          <h2>Settings</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close settings">
            Close
          </button>
        </header>

        <nav className="settings-tabs">
          <button
            className={tab === 'account' ? 'active' : ''}
            onClick={() => setTab('account')}
          >
            Account
          </button>
          <button
            className={tab === 'sync' ? 'active' : ''}
            onClick={() => setTab('sync')}
          >
            Sync
          </button>
          <button
            className={tab === 'storage' ? 'active' : ''}
            onClick={() => setTab('storage')}
          >
            Storage
          </button>
        </nav>

        <section className="settings-body">
          {tab === 'account' && (
            <AccountTab
              authStatus={authStatus}
              busyLogin={busyLogin}
              loginError={loginError}
              onLogin={handleLogin}
              onLogout={onLogout}
            />
          )}

          {tab === 'sync' && (
            <SyncTab
              syncStatus={syncStatus}
              settings={settings}
              authStatus={authStatus}
              passphrase={passphrase}
              onPassphraseChange={setPassphrase}
              revealPass={revealPass}
              onToggleReveal={() => setRevealPass((v) => !v)}
              onSyncNow={onSyncNow}
              onUpdateSetting={onUpdateSetting}
            />
          )}

          {tab === 'storage' && <StorageTab meta={meta} />}
        </section>
      </div>
    </div>
  );
}

function AccountTab({
  authStatus,
  busyLogin,
  loginError,
  onLogin,
  onLogout,
}: {
  authStatus: AuthStatus;
  busyLogin: boolean;
  loginError: string | null;
  onLogin: () => void | Promise<void>;
  onLogout: () => void | Promise<void>;
}) {
  return (
    <div className="settings-section">
      <h3>Google account</h3>
      <p className="muted">
        Zero Notes uses Google's OAuth 2.0 Desktop App flow. Your browser
        opens for sign-in — Zero Notes never sees your Google password.
        We only request the <code>drive.appdata</code> scope, so the sync
        file lives in a hidden per-app folder that's invisible from your
        regular Google Drive.
      </p>

      {!authStatus.connected ? (
        <div className="auth-card">
          <p>You're not signed in.</p>
          <button
            className="btn btn-primary"
            onClick={() => void onLogin()}
            disabled={busyLogin}
          >
            {busyLogin ? 'Waiting for browser…' : 'Login with Google'}
          </button>
          {loginError && <p className="error-text">{loginError}</p>}
        </div>
      ) : (
        <div className="auth-card connected">
          {authStatus.picture ? (
            <img className="auth-avatar" src={authStatus.picture} alt="" />
          ) : (
            <div className="auth-avatar fallback">
              {(authStatus.name || authStatus.email || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="auth-info">
            <div className="auth-name">{authStatus.name || authStatus.email}</div>
            <div className="muted small">{authStatus.email}</div>
          </div>
          <button className="btn btn-danger-ghost" onClick={() => void onLogout()}>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

function SyncTab({
  syncStatus,
  settings,
  authStatus,
  passphrase,
  onPassphraseChange,
  revealPass,
  onToggleReveal,
  onSyncNow,
  onUpdateSetting,
}: {
  syncStatus: SyncStatus;
  settings: AppSettings;
  authStatus: AuthStatus;
  passphrase: string;
  onPassphraseChange: (v: string) => void;
  revealPass: boolean;
  onToggleReveal: () => void;
  onSyncNow: () => void | Promise<void>;
  onUpdateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => Promise<void>;
}) {
  return (
    <div className="settings-section">
      <h3>Cloud sync (Google Drive appDataFolder)</h3>
      <p className="muted">
        Zero Notes stores its sync file as <code>zeronotes-sync.json</code>
        inside Google Drive's <em>appDataFolder</em>. This is a hidden,
        per-app sandbox — the file is invisible in your regular Drive UI
        and only this app can read it.
      </p>

      <div className="row-toggle">
        <label>
          <input
            type="checkbox"
            checked={settings.syncEnabled}
            onChange={(e) => void onUpdateSetting('syncEnabled', e.target.checked)}
          />{' '}
          Enable appDataFolder sync
        </label>
      </div>

      <div className="sync-status-block">
        <div>
          <strong>Status:</strong> {syncStatus.state}
        </div>
        <div>
          <strong>Last sync:</strong> {formatTimestamp(syncStatus.lastSyncAt)}
        </div>
        {syncStatus.lastError && (
          <div className="error-text">
            <strong>Last error:</strong> {syncStatus.lastError}
          </div>
        )}
      </div>

      <button
        className="btn btn-primary"
        onClick={() => void onSyncNow()}
        disabled={!authStatus.connected || syncStatus.state === 'syncing'}
      >
        {syncStatus.state === 'syncing' ? 'Syncing…' : 'Sync Now'}
      </button>

      <h4 style={{ marginTop: 24 }}>Conflict strategy</h4>
      <div className="row-radio">
        <label>
          <input
            type="radio"
            name="conflict"
            checked={settings.conflictStrategy === 'last-write-wins'}
            onChange={() => void onUpdateSetting('conflictStrategy', 'last-write-wins')}
          />{' '}
          Last write wins (recommended)
        </label>
        <label>
          <input
            type="radio"
            name="conflict"
            checked={settings.conflictStrategy === 'duplicate-on-conflict'}
            onChange={() =>
              void onUpdateSetting('conflictStrategy', 'duplicate-on-conflict')
            }
          />{' '}
          Keep both — create a "Conflict Copy"
        </label>
      </div>

      <h4 style={{ marginTop: 24 }}>Encrypted cloud sync</h4>
      <p className="muted">
        When enabled, the sync payload is encrypted with AES-256-GCM
        before upload. The passphrase is stored locally only — losing it
        means losing access to the encrypted cloud copy.
      </p>
      <div className="row-toggle">
        <label>
          <input
            type="checkbox"
            checked={settings.encryptCloudSync}
            onChange={(e) => void onUpdateSetting('encryptCloudSync', e.target.checked)}
          />{' '}
          Encrypt cloud sync payload
        </label>
      </div>
      {settings.encryptCloudSync && (
        <div className="passphrase-row">
          <input
            className="passphrase-input"
            type={revealPass ? 'text' : 'password'}
            placeholder="Encryption passphrase"
            value={passphrase}
            onChange={(e) => onPassphraseChange(e.target.value)}
          />
          <button className="btn btn-ghost" onClick={onToggleReveal}>
            {revealPass ? 'Hide' : 'Show'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              void onUpdateSetting(
                'encryptionPassphrase',
                passphrase as AppSettings['encryptionPassphrase']
              )
            }
          >
            Save passphrase
          </button>
        </div>
      )}

      <h4 style={{ marginTop: 24 }}>Auto-save delay</h4>
      <p className="muted">
        Zero Notes saves every change to local SQLite after this delay.
      </p>
      <input
        type="number"
        min={150}
        max={5000}
        step={50}
        value={settings.autoSaveDebounceMs}
        onChange={(e) =>
          void onUpdateSetting('autoSaveDebounceMs', Number(e.target.value) || 600)
        }
      />{' '}
      ms
    </div>
  );
}

function StorageTab({ meta }: { meta: AppMeta | null }) {
  return (
    <div className="settings-section">
      <h3>Local database</h3>
      <p className="muted">
        Notes live in SQLite on your machine — Zero Notes is local-first.
        Even with sync disabled, you keep working offline.
      </p>
      {meta && (
        <ul className="kv-list">
          <li>
            <span>Database file</span>
            <code>{meta.dbPath}</code>
          </li>
          <li>
            <span>App data folder</span>
            <code>{meta.appDataPath}</code>
          </li>
          <li>
            <span>App version</span>
            <code>{meta.version}</code>
          </li>
          <li>
            <span>Device ID</span>
            <code>{meta.deviceId}</code>
          </li>
          <li>
            <span>Platform</span>
            <code>{meta.platform}</code>
          </li>
        </ul>
      )}

      <h3 style={{ marginTop: 24 }}>Cloud storage</h3>
      <p className="muted">
        <strong>Google Drive · appDataFolder</strong>
        <br />
        File: <code>zeronotes-sync.json</code> (hidden per-app sandbox)
      </p>
      <p>
        <button
          className="btn btn-ghost"
          onClick={() =>
            void api.openExternal('https://drive.google.com/drive/u/0/settings')
          }
        >
          Manage connected apps in Google Drive ↗
        </button>
      </p>
    </div>
  );
}
