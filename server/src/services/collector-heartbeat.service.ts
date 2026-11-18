export interface CollectorHeartbeat {
  instanceId: string;
  lastSeenAt: Date;
}

const DEFAULT_RETENTION_MS = 60 * 60 * 1000;

export function normalizeCollectorInstanceId(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'unknown';
}

class CollectorHeartbeatService {
  private readonly heartbeats = new Map<string, Date>();

  markSeen(instanceId: string | null | undefined, seenAt = new Date()): CollectorHeartbeat {
    const normalized = normalizeCollectorInstanceId(instanceId);
    this.heartbeats.set(normalized, seenAt);
    this.prune();
    return { instanceId: normalized, lastSeenAt: seenAt };
  }

  list(retentionMs = DEFAULT_RETENTION_MS): CollectorHeartbeat[] {
    this.prune(retentionMs);
    return Array.from(this.heartbeats.entries())
      .map(([instanceId, lastSeenAt]) => ({ instanceId, lastSeenAt }))
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  private prune(retentionMs = DEFAULT_RETENTION_MS): void {
    const cutoff = Date.now() - retentionMs;
    for (const [instanceId, lastSeenAt] of this.heartbeats.entries()) {
      if (lastSeenAt.getTime() < cutoff) this.heartbeats.delete(instanceId);
    }
  }
}

export const collectorHeartbeatService = new CollectorHeartbeatService();
