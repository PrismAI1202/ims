-- Machines and moulds are now added, edited and removed on the Maintenance screen, not under Masters. Whoever could manage masters
-- keeps the ability, under the new permission.
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['equipment.manage']
  WHERE 'masters.manage' = ANY("permissions") AND NOT ('equipment.manage' = ANY("permissions"));
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['equipment.manage']
  WHERE "key" = 'ADMIN' AND NOT ('equipment.manage' = ANY("permissions"));
