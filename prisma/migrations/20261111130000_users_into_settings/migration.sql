-- The Users screen is now the People tab of Settings. Any role that had Users gets Settings instead, and the old key goes.
UPDATE "AccessRole" SET "views" = "views" || ARRAY['settings']
  WHERE 'users' = ANY("views") AND NOT ('settings' = ANY("views"));
UPDATE "AccessRole" SET "views" = array_remove("views", 'users') WHERE 'users' = ANY("views");
