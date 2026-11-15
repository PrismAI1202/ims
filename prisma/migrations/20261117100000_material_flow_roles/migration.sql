-- Default roles brought in line with the "Material Flow" document:
--   Admin uploads customer demand and reads the MRP plan (with the Planner).
--   Production Lead sees each part's BOM: the blend and the regrind limit it moulds to.
-- Added at the end of each role's list so its menu order and phone tabs stay put; a role that already has the screen is left alone.
UPDATE "AccessRole" SET "views" = "views" || ARRAY['demand'] WHERE "key" = 'ADMIN' AND NOT ('demand' = ANY("views"));
UPDATE "AccessRole" SET "views" = "views" || ARRAY['mrp'] WHERE "key" = 'ADMIN' AND NOT ('mrp' = ANY("views"));
UPDATE "AccessRole" SET "views" = "views" || ARRAY['bom'] WHERE "key" = 'PRODUCTION_LEAD' AND NOT ('bom' = ANY("views"));
