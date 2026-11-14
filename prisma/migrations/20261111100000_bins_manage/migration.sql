-- Bins are now edited on the Stores bin map (Edit layout) instead of under Masters.
-- Admin needs the Stores screen and the new bins.manage action to keep adding racks, shelves and bins.
UPDATE "AccessRole" SET "views" = "views" || ARRAY['stock']
  WHERE "key" = 'ADMIN' AND NOT ('stock' = ANY("views"));
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['bins.manage']
  WHERE "key" = 'ADMIN' AND NOT ('bins.manage' = ANY("permissions"));
