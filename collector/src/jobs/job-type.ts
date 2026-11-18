/**
 * Ingestion job types — must stay in sync with the server's copy
 * (server/src/lib/job-type.ts), which is the single source of truth: these
 * values are stored in the server's Postgres enum and arrive here over the
 * internal claim API.
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
