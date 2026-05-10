import type { SyncState, SyncStatus } from '../types';
import { formatRelativeTime } from '../util';

const LABELS: Record<SyncState, string> = {
  offline: 'Offline',
  syncing: 'Syncing…',
  synced: 'Synced',
  error: 'Sync error',
};

export function SyncBadge({ status }: { status: SyncStatus }) {
  const label = LABELS[status.state];
  const subtitle =
    status.state === 'error'
      ? status.lastError || 'Unknown error'
      : `Last sync: ${formatRelativeTime(status.lastSyncAt)}`;
  return (
    <div className={`sync-badge sync-${status.state}`} title={subtitle}>
      <span className="sync-dot" />
      <span className="sync-label">{label}</span>
      <span className="sync-sub">{subtitle}</span>
    </div>
  );
}
