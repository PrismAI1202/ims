-- Customers and suppliers are now edited on the Customers & suppliers screen (Edit list), not under Masters.
-- Whoever could manage masters keeps the ability, under the new permission.
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['partners.manage']
  WHERE 'masters.manage' = ANY("permissions") AND NOT ('partners.manage' = ANY("permissions"));
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['partners.manage']
  WHERE "key" = 'ADMIN' AND NOT ('partners.manage' = ANY("permissions"));
