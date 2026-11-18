-- Legacy preflight only; read-only. Run with psql -X -v ON_ERROR_STOP=1 -f this-file.
-- Run against the existing database BEFORE the position migration, with the app stopped.
BEGIN READ ONLY;
SELECT
  (SELECT count(*) FROM organizations) AS organizations,
  (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM mailboxes) AS mailboxes,
  (SELECT count(*) FROM org_nodes) AS positions,
  (SELECT count(*) FROM org_nodes WHERE manager_id IS NULL) AS roots,
  (SELECT count(*) FROM org_closure) AS closure_rows;

SELECT n.org_id,n.id AS position_id,'missing/cross-org manager' AS issue
FROM org_nodes n LEFT JOIN org_nodes m ON m.user_id=n.manager_id
WHERE n.manager_id IS NOT NULL AND (m.id IS NULL OR m.org_id<>n.org_id);

WITH RECURSIVE reachable(a,b) AS (
 SELECT manager_id,user_id FROM org_nodes WHERE manager_id IS NOT NULL
 UNION SELECT r.a,n.user_id FROM reachable r JOIN org_nodes n ON n.manager_id=r.b
) SELECT a AS cycle_user FROM reachable WHERE a=b;

WITH RECURSIVE paths(a,b,depth) AS (
 SELECT user_id,user_id,0 FROM org_nodes
 UNION SELECT p.a,n.user_id,p.depth+1 FROM paths p JOIN org_nodes n ON n.manager_id=p.b
 WHERE p.depth<(SELECT count(*) FROM org_nodes)
), expected AS (SELECT a AS ancestor,b AS descendant,min(depth)::integer AS depth FROM paths GROUP BY a,b)
SELECT 'missing/wrong closure' AS issue,* FROM
 (SELECT * FROM expected EXCEPT SELECT ancestor,descendant,depth FROM org_closure) missing
UNION ALL SELECT 'extra/wrong closure',* FROM
 (SELECT ancestor,descendant,depth FROM org_closure EXCEPT SELECT * FROM expected) extra;

SELECT n.id AS position_id,m.id AS mailbox_id,'cross-org owned mailbox' AS issue
FROM org_nodes n JOIN mailboxes m ON m.owner_user_id=n.user_id WHERE m.org_id<>n.org_id;
SELECT id AS position_id,'overlength title' AS issue FROM org_nodes WHERE length(btrim(title))>200;
COMMIT;

