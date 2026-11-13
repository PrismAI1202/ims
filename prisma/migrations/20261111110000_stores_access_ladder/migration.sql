-- Stores access is now one ladder in Settings: View, Move stock, Edit layout. Each rung includes the one below, so a role
-- that can edit the layout can also move stock. Admin already had Edit layout; give it the Move stock permission to match.
UPDATE "AccessRole" SET "permissions" = "permissions" || ARRAY['stock.transfer']
  WHERE "key" = 'ADMIN' AND 'bins.manage' = ANY("permissions") AND NOT ('stock.transfer' = ANY("permissions"));
