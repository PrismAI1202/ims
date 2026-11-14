-- Supplier PO and Dispatch are now part of Orders. Each keeps its own action permission, because the old views granted
-- po.manage / dispatch.manage implicitly and Orders does not. A role's screen is replaced in place so its phone tabs stay put.
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['po.manage']
  WHERE 'purchase' = ANY("views") AND NOT ('po.manage' = ANY("permissions"));
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['dispatch.manage']
  WHERE 'dispatch' = ANY("views") AND NOT ('dispatch.manage' = ANY("permissions"));

UPDATE "AccessRole" SET "views" = array_replace("views", 'dispatch', 'orders')
  WHERE 'dispatch' = ANY("views") AND NOT ('orders' = ANY("views"));
UPDATE "AccessRole" SET "views" = array_replace("views", 'purchase', 'orders')
  WHERE 'purchase' = ANY("views") AND NOT ('orders' = ANY("views"));
UPDATE "AccessRole" SET "views" = array_remove(array_remove("views", 'purchase'), 'dispatch')
  WHERE 'purchase' = ANY("views") OR 'dispatch' = ANY("views");
