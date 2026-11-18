# Plan — Durable content storage and rebuildable vector search

> **Status:** Recommended architecture.
> **Goal:** Keep PostgreSQL small, automatically index mail, attachments and
> future business sources, and preserve a safe canonical copy outside Qdrant.

---

## 1. Decision

**Do not make Qdrant the only copy of business content.**

Qdrant is a search index. Embedding models, vector sizes and chunking rules
change over time, so every Qdrant collection must remain rebuildable.

Use four layers:

| Layer | Responsibility |
|---|---|
| **PostgreSQL** | Metadata, permissions, source versions, processing state, audit and retention decisions |
| **MinIO / S3-compatible storage** | Canonical email bodies, documents, extracted text and optional original files |
| **Qdrant** | Search chunks, vectors and small filterable metadata |
| **Provider / MCP connector** | Discover new or changed mail, accounting records and other source data |

If object storage is not approved, keep `messages.body_text` in PostgreSQL.
Using Qdrant as the only stored copy is not an acceptable fallback.

---

## 2. Why this is better than Qdrant-only storage

One 2 KB email body can occupy roughly 10–12 KB after chunk text, metadata and
768-dimensional vectors are stored. Moving text from PostgreSQL to Qdrant makes
PostgreSQL smaller, but it does not reduce total storage.

Qdrant-only storage also creates four operational problems:

- Re-chunking requires the original uncut content.
- A new embedding model requires rebuilding every vector.
- Search-index corruption becomes content loss.
- The detail page needs a whole-text copy in addition to overlapping chunks.

Object storage provides a cheap canonical copy while keeping PostgreSQL backups
small and allowing Qdrant to be recreated at any time.

---

## 3. Target architecture

```text
Mail provider / QuickBooks / SimpleBooks / MCP source
                         │
                         ▼
              Discover source record
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
 PostgreSQL metadata              Transactional outbox
 and permissions                  indexing request
          │                             │
          └──────────────┬──────────────┘
                         ▼
             Save canonical content
                 in MinIO / S3
                         │
                         ▼
             Extract text / run OCR
                         │
                         ▼
              Chunk and create vectors
                         │
                         ▼
                    Qdrant index
                         │
                         ▼
          Reconcile checksum and points
                         │
                         ▼
              Mark version as verified
```

Lists, counts, sorting, organisation hierarchy and permissions continue to use
PostgreSQL. Detail views read canonical content from object storage. Semantic
search uses Qdrant and resolves results back through PostgreSQL permissions.

---

## 4. Canonical content model

Introduce a source-neutral content record so future integrations do not need
their own storage architecture.

```text
content_objects
  id
  org_id
  source_type          mail | attachment | quickbooks | simplebooks | mcp
  source_id            stable provider/business identifier
  source_version       provider version, modified time or content hash
  parent_id            message/document parent when applicable
  object_key           private MinIO key
  extracted_text_key   optional normalized-text object
  sha256
  mime_type
  size_bytes
  retention_class
  created_at
```

Suggested private object keys:

```text
org/{org_id}/mail/{message_id}/{version}/body.json.gz
org/{org_id}/attachments/{attachment_id}/{version}/original
org/{org_id}/attachments/{attachment_id}/{version}/extracted.txt.gz
org/{org_id}/quickbooks/{entity}/{source_id}/{version}.json.gz
```

Do not expose bucket URLs directly. All reads must pass through the Core Server,
which applies the same mailbox and organisation-hierarchy checks used today.

---

## 5. Processing ledger

Replace reliance on only global timestamp cursors with per-content processing
state. Cursors remain useful for provider discovery, but they must not be the
proof that an individual record was indexed.

```text
discovered
    → content_saved
    → text_extracted
    → vectorized
    → verified
    → purge_eligible
```

Suggested ledger:

```text
content_index_state
  content_object_id
  source_version
  status
  attempt_count
  last_error
  next_attempt_at
  embed_model
  vector_size
  chunk_size
  chunk_overlap
  chunk_config_hash
  expected_point_count
  indexed_at
  verified_at
```

Create the outbox/index-state row in the same PostgreSQL transaction that saves
the source metadata. A process crash must never leave content without a queued
indexing request.

Workers claim rows using `FOR UPDATE SKIP LOCKED`. Failures retry with bounded
exponential backoff. One bad attachment must not block unrelated mail.

---

## 6. Idempotent Qdrant indexing

Use deterministic point IDs rather than random UUIDs followed by delete/upsert:

```text
point_id = hash(org_id, source_type, source_id, source_version, chunk_number)
```

Store only what retrieval requires:

- Chunk text
- Content/source IDs and version
- Organisation and mailbox IDs
- Filename, subject, sender and dates needed for citations
- Permission/filter fields
- Chunk number and configuration hash

Do not store a second whole-body copy in Qdrant. The detail view reads the
canonical object instead.

When a version changes:

1. Write the new canonical object.
2. Index deterministic points for the new version.
3. Verify the expected points.
4. Atomically mark the new version active in PostgreSQL.
5. Delete old-version points asynchronously.

Search must filter to the active source version.

---

## 7. Mail and attachment workflow

The existing combined automatic workflow remains the entry point:

1. Collector completes a mailbox sync.
2. Core Server records message metadata.
3. Core Server automatically discovers attachment descriptors.
4. Canonical body and supported attachment content are written to object storage.
5. RAG extracts text, runs OCR, chunks and embeds.
6. Qdrant points are verified.
7. PostgreSQL records the verified version.

The deprecated attachment-only command remains a repair tool. Normal operation
must never require a user to run it.

Attachment safeguards must run before large downloads:

- Allowlisted MIME types and extensions
- Provider-reported size limit
- Streamed download limit that does not trust provider metadata
- MIME sniffing after download
- Archive expansion limits
- Malware scanning where original files are retained
- OCR page/pixel/time limits

Unsupported or oversized files are recorded as `skipped` with a reason. They
must not silently disappear or permanently block the mailbox cursor.

---

## 8. Attachment retention choices

Choose one policy per organisation or retention class:

| Policy | Stored | Trade-off |
|---|---|---|
| **Extracted text only** | Normalized extracted text | Smallest; cannot rerun improved OCR |
| **Original + extracted text** | Provider file and normalized text | Best rebuildability; more storage |
| **Original with lifecycle** | Original temporarily, extracted text longer | Balanced default |
| **Provider only** | No local file copy | Cheapest; provider deletion can make rebuilding impossible |

Recommended default:

- Keep compressed extracted text for the full configured retention period.
- Keep original supported files for 90 days, then move to cheaper storage or
  delete according to policy.
- Retain originals longer when legal, audit or re-OCR requirements demand it.

---

## 9. Detail and list reads

| Operation | Store |
|---|---|
| Email/document lists, paging and sorting | PostgreSQL |
| Organisation hierarchy and permissions | PostgreSQL |
| One message/document detail | MinIO through Core Server |
| Semantic search | Qdrant |
| Original attachment download | MinIO when retained, otherwise provider |

Qdrant is unsuitable for lists because one source record produces many points
and Qdrant does not provide relational paging, grouping or authoritative counts.

During migration, detail reads use this fallback order:

1. Object storage
2. Existing PostgreSQL `body_text`
3. Provider refetch when permitted

Log mismatches between object storage and PostgreSQL during the dual-read phase.

---

## 10. Backup and recovery

The system of record becomes PostgreSQL plus object storage:

- PostgreSQL backup includes metadata, permissions and processing state.
- MinIO uses versioning, encryption, retention and offsite replication.
- Qdrant snapshots improve recovery time but are not the only recovery path.

Required restore exercise:

1. Restore PostgreSQL into an isolated environment.
2. Restore or attach the replicated object bucket.
3. Recreate empty Qdrant collections.
4. Rebuild vectors from verified content objects.
5. Confirm counts, checksums, permissions and sample searches.

No PostgreSQL body purge is allowed before this exercise succeeds.

---

## 11. Safe migration phases

### Phase 0 — Policy and measurement

- Measure PostgreSQL, attachment and estimated object-storage volume.
- Decide retention classes and maximum attachment size.
- Decide whether original attachments are retained.
- Confirm legal/provider-only retention requirements.

**Done when:** storage, retention and sign-off owners are documented.

### Phase 1 — Object-storage foundation

- Deploy MinIO/S3 with private buckets and encryption.
- Add `content_objects` and `content_index_state`.
- Add checksums and source versions.
- Implement streamed, size-limited object writes.

**Done when:** new content is dual-written without changing existing reads.

### Phase 2 — Reliable ingestion ledger

- Create transactional outbox records with source metadata.
- Add retryable workers and per-item status.
- Backfill existing mail and attachment text into object storage.
- Surface failed/skipped items in monitoring.

**Done when:** every source record has a visible terminal or retryable state.

### Phase 3 — Rebuildable Qdrant

- Index from object storage.
- Introduce deterministic point IDs and configuration hashes.
- Filter search to active source versions.
- Add a full rebuild command from verified content objects.

**Done when:** deleting and recreating Qdrant produces identical verified counts.

### Phase 4 — Detail reads from object storage

- Add a Core Server content-detail endpoint.
- Put object-storage reads behind a feature flag.
- Dual-read PostgreSQL and object storage.
- Rewire thread summarization to canonical content.

**Done when:** mismatches remain zero for at least seven days.

### Phase 5 — Reconciliation and restore

- Verify checksums and expected Qdrant point counts.
- Display drift beside the vector-processing dashboard.
- Configure PostgreSQL, MinIO and Qdrant backup schedules.
- Perform and document a complete restore.

**Done when:** drift is zero and the restore exercise passes.

### Phase 6 — Optional PostgreSQL body purge

- Add `indexed_at`, `verified_at` and `body_purged_at`.
- Require at least a 30-day verified grace window.
- Purge only small batches with a reachable stop switch.
- Never delete the `messages` row.
- Never purge failed, skipped or unverified content.

**Done when:** PostgreSQL size decreases and detail/search behaviour is unchanged.

---

## 12. Purge eligibility

A message body may be cleared only when all conditions are true:

```text
canonical object exists
AND checksum matches
AND content version is active
AND expected Qdrant points are verified
AND verified_at is older than the grace window
AND backup policy is healthy
AND legal hold is false
AND purge switch is enabled
```

The purge process clears only `messages.body_text`. Message IDs, provider IDs,
subjects, participants, timestamps, thread links and permission data remain.

---

## 13. Monitoring

Display these numbers on the existing vector-processing page:

- Discovered and queued items
- Content-save, extraction, OCR and vectorization progress
- Verified, failed, skipped and retrying items
- PostgreSQL rows still awaiting object migration
- Object-storage checksum failures
- Qdrant drift: expected versus actual points
- Oldest queued item
- Last successful backup and restore exercise
- Purge-eligible and purged body counts

Alerts are required when:

- The queue age exceeds its SLA.
- All attachment downloads fail.
- Object storage is unavailable.
- Verification drift is non-zero.
- Backup age exceeds policy.
- A purge attempt sees an unhealthy backup or reconciliation state.

---

## 14. Security and tenancy

- Use private buckets with no anonymous access.
- Encrypt in transit and at rest.
- Scope every object key and database lookup by `org_id`.
- Authorize through PostgreSQL before returning object content.
- Never trust an object key supplied directly by a client.
- Record content reads, downloads, retention changes and purge actions.
- Treat extracted text as untrusted business content, not executable instructions.
- Keep provider and MinIO credentials out of Qdrant payloads and logs.

---

## 15. Rollback

Phases 1–5 are additive and reversible:

- Disable object-storage detail reads.
- Continue reading `messages.body_text`.
- Rebuild or discard Qdrant collections.
- Retry content migration from PostgreSQL/provider sources.

Phase 6 is the only destructive phase. After a body is purged from PostgreSQL,
rollback depends on object storage or the provider. That is why verified objects,
backup health and the grace period are hard gates rather than recommendations.

---

## 16. Open decisions

1. MinIO on the application node, a dedicated storage node or an external S3 service?
2. Which attachment types and maximum sizes are supported?
3. Extracted-text-only or original-file retention for each organisation?
4. Default lifecycle: 90 days for originals and policy duration for extracted text?
5. Required encryption-key ownership and rotation process?
6. Who approves PostgreSQL body purging and legal-hold behaviour?
7. What queue-age, drift and backup-age thresholds trigger alerts?

---

## 17. Final recommendation

PostgreSQL should keep facts and workflow state. MinIO should keep canonical
content. Qdrant should remain a disposable, rebuildable semantic index.
Provider and MCP connectors should only discover and fetch source versions.

Do not purge `body_text` until object storage, per-item processing state,
deterministic Qdrant indexing, reconciliation and a rehearsed restore are all
operational. If object storage is rejected, stop before purge and retain email
content in PostgreSQL.
