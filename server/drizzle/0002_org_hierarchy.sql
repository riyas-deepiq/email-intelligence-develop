-- =============================================================================
-- 0002_org_hierarchy.sql
-- Org hierarchy: adjacency list (org_nodes) + transitive closure (org_closure).
-- Closure table is maintained by application code on every add / move / remove.
-- =============================================================================

-- ── org_nodes ─────────────────────────────────────────────────────────────────
-- One row per user placed in the org hierarchy. manager_id = null → root node.

CREATE TABLE "org_nodes" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"      uuid        NOT NULL,
  "user_id"     uuid        NOT NULL,
  "manager_id"  uuid,
  "title"       text,
  "department"  text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "org_nodes_user_unique" UNIQUE ("user_id"),
  CONSTRAINT "org_nodes_org_fk"     FOREIGN KEY ("org_id")     REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "org_nodes_user_fk"    FOREIGN KEY ("user_id")    REFERENCES "users"("id")         ON DELETE CASCADE,
  CONSTRAINT "org_nodes_mgr_fk"     FOREIGN KEY ("manager_id") REFERENCES "users"("id")         ON DELETE SET NULL
);

-- ── org_closure ───────────────────────────────────────────────────────────────
-- Transitive closure of org_nodes for O(1) descendant / permission queries.
-- Each node has a self-referential row (ancestor = descendant, depth = 0).

CREATE TABLE "org_closure" (
  "ancestor"    uuid    NOT NULL,
  "descendant"  uuid    NOT NULL,
  "depth"       integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("ancestor", "descendant"),
  CONSTRAINT "org_closure_ancestor_fk"   FOREIGN KEY ("ancestor")   REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "org_closure_descendant_fk" FOREIGN KEY ("descendant") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "org_closure_ancestor_idx"   ON "org_closure" ("ancestor");
CREATE INDEX "org_closure_descendant_idx" ON "org_closure" ("descendant");
