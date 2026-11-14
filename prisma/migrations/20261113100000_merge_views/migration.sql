-- Screens merged into others:
--   Stock count + Approvals  -> Stores (actions stock.count / stock.adjust)
--   Issue + Return to stores -> Material requests (one flow; steps are the permissions request.create / stock.issue / material.return)
--   Returnable ledger        -> Finished goods (the Crates tab, crates.manage)
--   Equivalent materials + BOM variance -> BOMs (reached by opening a BOM)
-- The old screens granted their permission implicitly, but the merged ones are opened by the permission itself, so write
-- each one out first. The first old screen a role had is swapped for the merged one in the same place (so its phone tabs
-- stay put); the rest are dropped.
DO $$
DECLARE m record;
BEGIN
  FOR m IN SELECT * FROM (VALUES
    ('requests', 'requests', 'request.create'), -- first, before 'issue' and 'returns' turn into 'requests'
    ('count', 'stock', 'stock.count'),
    ('approvals', 'stock', 'stock.adjust'),
    ('issue', 'requests', 'stock.issue'),
    ('returns', 'requests', 'material.return'),
    ('fg', 'fg', 'fg.pack'),
    ('returnables', 'fg', 'crates.manage'),
    ('bom', 'bom', 'bom.manage'),
    ('equivalents', 'bom', NULL),
    ('variance', 'bom', 'reports.view')
  ) AS t(old_view, new_view, perm)
  LOOP
    IF m.perm IS NOT NULL THEN
      UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY[m.perm::text]
        WHERE m.old_view = ANY("views") AND NOT (m.perm = ANY("permissions"));
    END IF;
    UPDATE "AccessRole" SET "views" = array_replace("views", m.old_view::text, m.new_view::text)
      WHERE m.old_view <> m.new_view AND m.old_view = ANY("views") AND NOT (m.new_view = ANY("views"));
    UPDATE "AccessRole" SET "views" = array_remove("views", m.old_view::text)
      WHERE m.old_view <> m.new_view AND m.old_view = ANY("views");
  END LOOP;
END $$;
