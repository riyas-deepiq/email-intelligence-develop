/**
 * Ingestion job types — the single source of truth.
 *
 * The string values are stored in Postgres (enum `job_type` on
 * `ingestion_jobs.job_type`) and travel over the collector⇄server internal
 * API, so they must stay in sync with the collector's copy of this module
 * (collector/src/lib/job-type.ts) and with the DB enum (see migration 0017).
 * To rename one: change it here + in the collector copy + one ALTER TYPE
 * migration — nothing else references the raw strings.
 */
export const JobType = {
  /** Count the emails and find the oldest — downloads nothing. */
  MailboxScan: 'mailbox_scan',
  /** First-ever download of the mailbox's history. */
  InitialImport: 'initial_import',
  /** Fetch only what arrived since the last run (uses the saved sync cursor). */
  NewMailCheck: 'new_mail_check',
  /** Admin deepened the sync range — fetch only the older gap. */
  SyncRangeExtension: 'sync_range_extension',
} as const;

export type JobType = (typeof JobType)[keyof typeof JobType];

export const JOB_TYPE_VALUES = [
  JobType.MailboxScan,
  JobType.InitialImport,
  JobType.NewMailCheck,
  JobType.SyncRangeExtension,
] as const;

/** Human-readable names for logs, alerts, and the UI. */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  [JobType.MailboxScan]: 'Mailbox scan',
  [JobType.InitialImport]: 'Initial import',
  [JobType.NewMailCheck]: 'New-mail check',
  [JobType.SyncRangeExtension]: 'Sync range extension',
};
