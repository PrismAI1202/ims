-- Inward QC, Scrap approval, Final inspection, First-off and Return to supplier become tabs of one Quality screen.
-- Each old screen granted its permission implicitly, but a Quality tab is opened by the permission itself, so write them out first.
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['qc.inspect']      WHERE 'qc' = ANY("views")    AND NOT ('qc.inspect' = ANY("permissions"));
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['scrap.approve']   WHERE 'scrap' = ANY("views") AND NOT ('scrap.approve' = ANY("permissions"));
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['pdi.release']     WHERE 'pdi' = ANY("views")   AND NOT ('pdi.release' = ANY("permissions"));
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['rtv.manage']      WHERE 'rtv' = ANY("views")   AND NOT ('rtv.manage' = ANY("permissions"));

-- The first old screen a role had becomes Quality in the same place (so its phone tabs stay put); the rest are dropped.
UPDATE "AccessRole" SET "views" = array_replace("views", 'qc', 'quality')       WHERE 'qc' = ANY("views")       AND NOT ('quality' = ANY("views"));
UPDATE "AccessRole" SET "views" = array_replace("views", 'scrap', 'quality')    WHERE 'scrap' = ANY("views")    AND NOT ('quality' = ANY("views"));
UPDATE "AccessRole" SET "views" = array_replace("views", 'pdi', 'quality')      WHERE 'pdi' = ANY("views")      AND NOT ('quality' = ANY("views"));
UPDATE "AccessRole" SET "views" = array_replace("views", 'rtv', 'quality')      WHERE 'rtv' = ANY("views")      AND NOT ('quality' = ANY("views"));
UPDATE "AccessRole" SET "views" = array_replace("views", 'firstoff', 'quality') WHERE 'firstoff' = ANY("views") AND NOT ('quality' = ANY("views"));
UPDATE "AccessRole" SET "views" = array_remove(array_remove(array_remove(array_remove(array_remove("views", 'qc'), 'scrap'), 'pdi'), 'rtv'), 'firstoff')
  WHERE "views" && ARRAY['qc', 'scrap', 'pdi', 'rtv', 'firstoff'];
