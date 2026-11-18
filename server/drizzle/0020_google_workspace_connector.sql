-- Persist the non-secret Google Workspace delegation identity and directory
-- customer. The private service-account JSON remains AES-256-GCM encrypted in
-- service_account_json.

ALTER TABLE "auth_providers"
  ADD COLUMN IF NOT EXISTS "google_admin_email" text;

ALTER TABLE "auth_providers"
  ADD COLUMN IF NOT EXISTS "google_customer_id" text;
