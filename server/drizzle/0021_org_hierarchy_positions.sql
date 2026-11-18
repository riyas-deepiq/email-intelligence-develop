-- Drizzle executes this migration transactionally. Never apply to a live database before backup.
SELECT pg_advisory_xact_lock(hashtext('insight-hub:org-hierarchy'));
LOCK TABLE org_nodes, org_closure IN ACCESS EXCLUSIVE MODE;

-- Abort on pre-existing invalid manager edges; do not silently discard relationships.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM org_nodes n LEFT JOIN org_nodes p ON p.user_id = n.manager_id
    WHERE n.manager_id IS NOT NULL AND (p.id IS NULL OR p.org_id <> n.org_id)
  ) THEN RAISE EXCEPTION 'Hierarchy migration blocked: missing or cross-organization manager'; END IF;
END $$;

CREATE TEMP TABLE legacy_expected ON COMMIT DROP AS
WITH RECURSIVE paths(ancestor, descendant, depth) AS (
  SELECT user_id, user_id, 0 FROM org_nodes
  UNION
  SELECT p.ancestor, n.user_id, p.depth + 1
  FROM paths p JOIN org_nodes n ON n.manager_id = p.descendant
  WHERE p.depth < (SELECT count(*) FROM org_nodes)
)
SELECT ancestor, descendant, min(depth)::integer AS depth FROM paths GROUP BY ancestor, descendant;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM legacy_expected WHERE depth >= (SELECT count(*) FROM org_nodes) AND depth > 0)
    OR EXISTS (
      WITH RECURSIVE reachable(a,b) AS (
        SELECT manager_id, user_id FROM org_nodes WHERE manager_id IS NOT NULL
        UNION SELECT r.a, n.user_id FROM reachable r JOIN org_nodes n ON n.manager_id = r.b
      ) SELECT 1 FROM reachable WHERE a=b
    )
  THEN RAISE EXCEPTION 'Hierarchy migration blocked: reporting cycle'; END IF;
  IF EXISTS (
    (SELECT * FROM legacy_expected EXCEPT SELECT ancestor, descendant, depth FROM org_closure)
    UNION ALL
    (SELECT ancestor, descendant, depth FROM org_closure EXCEPT SELECT * FROM legacy_expected)
  ) THEN RAISE EXCEPTION 'Hierarchy migration blocked: repair legacy closure integrity first'; END IF;
END $$;

-- Capture the legacy ancestry for transactional before/after scope comparison.
CREATE TEMP TABLE legacy_pairs ON COMMIT DROP AS SELECT ancestor, descendant FROM org_closure;
CREATE TEMP TABLE legacy_mailbox_scope ON COMMIT DROP AS
SELECT DISTINCT c.ancestor, m.id AS mailbox_id FROM org_closure c
JOIN mailboxes m ON m.owner_user_id=c.descendant;
DO $$ DECLARE fk record; BEGIN
  FOR fk IN SELECT conname FROM pg_constraint
    WHERE conrelid='org_nodes'::regclass AND contype='f' AND confrelid='users'::regclass
  LOOP EXECUTE format('ALTER TABLE org_nodes DROP CONSTRAINT %I', fk.conname); END LOOP;
END $$;
ALTER TABLE org_nodes ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE org_nodes ADD CONSTRAINT org_nodes_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL;
UPDATE org_nodes SET title=COALESCE(NULLIF(btrim(title),''),'Position');
ALTER TABLE org_nodes ALTER COLUMN title SET NOT NULL;
ALTER TABLE org_nodes ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
CREATE INDEX org_nodes_org_idx ON org_nodes(org_id);
ALTER TABLE org_nodes ADD CONSTRAINT org_nodes_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200);

CREATE TABLE org_reporting_lines (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  manager_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  report_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(manager_node_id, report_node_id),
  CONSTRAINT org_reporting_no_self CHECK(manager_node_id <> report_node_id)
);
CREATE INDEX org_reporting_report_idx ON org_reporting_lines(report_node_id);
INSERT INTO org_reporting_lines(org_id, manager_node_id, report_node_id)
SELECT child.org_id, parent.id, child.id FROM org_nodes child JOIN org_nodes parent ON parent.user_id=child.manager_id;

-- Preserve forests by adding one VACANT organization root; no user gains extra scope.
DO $$ DECLARE o record; root_id uuid; BEGIN
  FOR o IN SELECT org_id FROM org_nodes WHERE manager_id IS NULL GROUP BY org_id HAVING count(*) > 1 LOOP
    INSERT INTO org_nodes(org_id,title) VALUES(o.org_id,'Organization') RETURNING id INTO root_id;
    INSERT INTO org_reporting_lines(org_id,manager_node_id,report_node_id)
      SELECT o.org_id,root_id,n.id FROM org_nodes n
      WHERE n.org_id=o.org_id AND n.manager_id IS NULL AND n.id<>root_id;
  END LOOP;
END $$;

DROP TABLE org_closure;
CREATE TABLE org_closure (
  ancestor_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  descendant_node_id uuid NOT NULL REFERENCES org_nodes(id) ON DELETE CASCADE,
  depth integer NOT NULL DEFAULT 0 CHECK(depth >= 0),
  PRIMARY KEY(ancestor_node_id,descendant_node_id)
);
CREATE INDEX org_closure_descendant_idx ON org_closure(descendant_node_id);

CREATE FUNCTION rebuild_org_closure(target_org uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM org_closure WHERE ancestor_node_id IN (SELECT id FROM org_nodes WHERE org_id=target_org);
  INSERT INTO org_closure(ancestor_node_id,descendant_node_id,depth)
  WITH RECURSIVE paths(a,b,depth) AS (
    SELECT id,id,0 FROM org_nodes WHERE org_id=target_org
    UNION
    SELECT p.a,e.report_node_id,p.depth+1 FROM paths p
    JOIN org_reporting_lines e ON e.manager_node_id=p.b AND e.org_id=target_org
    WHERE p.depth < (SELECT count(*) FROM org_nodes WHERE org_id=target_org)
  ) SELECT a,b,min(depth) FROM paths GROUP BY a,b;
END $$;
DO $$ DECLARE o record; BEGIN
  FOR o IN SELECT DISTINCT org_id FROM org_nodes LOOP PERFORM rebuild_org_closure(o.org_id); END LOOP;
END $$;
CREATE TEMP TABLE migrated_pairs ON COMMIT DROP AS
SELECT a.user_id AS ancestor,d.user_id AS descendant FROM org_closure c
JOIN org_nodes a ON a.id=c.ancestor_node_id JOIN org_nodes d ON d.id=c.descendant_node_id
WHERE a.user_id IS NOT NULL AND d.user_id IS NOT NULL;
DO $$ BEGIN
  IF EXISTS (
    (SELECT * FROM legacy_pairs EXCEPT SELECT * FROM migrated_pairs)
    UNION ALL (SELECT * FROM migrated_pairs EXCEPT SELECT * FROM legacy_pairs)
  ) THEN RAISE EXCEPTION 'Hierarchy migration blocked: user scope changed'; END IF;
END $$;
ALTER TABLE org_nodes DROP COLUMN manager_id;
-- Prove actual mailbox scope too, including organizations and retained inactive accounts.
DO $$ BEGIN
  IF EXISTS (
    WITH migrated_scope AS (
      SELECT DISTINCT a.user_id AS ancestor,m.id AS mailbox_id FROM org_closure c
      JOIN org_nodes a ON a.id=c.ancestor_node_id JOIN org_nodes d ON d.id=c.descendant_node_id
      JOIN mailboxes m ON m.owner_user_id=d.user_id
      WHERE a.user_id IS NOT NULL AND (m.org_id=a.org_id OR m.owner_user_id=a.user_id)
    )
    (SELECT * FROM legacy_mailbox_scope EXCEPT SELECT * FROM migrated_scope)
    UNION ALL (SELECT * FROM migrated_scope EXCEPT SELECT * FROM legacy_mailbox_scope)
  ) THEN RAISE EXCEPTION 'Hierarchy migration blocked: mailbox scope changed; check cross-organization ownership'; END IF;
END $$;

-- Guard direct SQL writers as well as application writers. Deferred checks see the final graph.
CREATE FUNCTION guard_org_graph() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_org uuid; roots integer; BEGIN
  target_org := CASE WHEN TG_OP='DELETE' THEN OLD.org_id ELSE NEW.org_id END;
  IF NOT EXISTS(SELECT 1 FROM organizations WHERE id=target_org) THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM org_reporting_lines e JOIN org_nodes a ON a.id=e.manager_node_id
    JOIN org_nodes b ON b.id=e.report_node_id WHERE e.org_id=target_org AND (a.org_id<>e.org_id OR b.org_id<>e.org_id))
  THEN RAISE EXCEPTION 'Cross-organization reporting line'; END IF;
  SELECT count(*) INTO roots FROM org_nodes n WHERE n.org_id=target_org AND NOT EXISTS(
    SELECT 1 FROM org_reporting_lines e WHERE e.report_node_id=n.id);
  IF EXISTS(SELECT 1 FROM org_nodes WHERE org_id=target_org) AND roots<>1
  THEN RAISE EXCEPTION 'Hierarchy must have exactly one root'; END IF;
  IF EXISTS(
    WITH RECURSIVE reachable(a,b) AS (
      SELECT manager_node_id,report_node_id FROM org_reporting_lines WHERE org_id=target_org
      UNION SELECT r.a,e.report_node_id FROM reachable r JOIN org_reporting_lines e ON e.manager_node_id=r.b
    ) SELECT 1 FROM reachable WHERE a=b
  ) THEN RAISE EXCEPTION 'Reporting cycle'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER org_edges_guard AFTER INSERT OR UPDATE OR DELETE ON org_reporting_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_org_graph();
CREATE CONSTRAINT TRIGGER org_nodes_guard AFTER INSERT OR UPDATE OR DELETE ON org_nodes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_org_graph();
