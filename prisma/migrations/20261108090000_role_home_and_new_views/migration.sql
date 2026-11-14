-- Home widgets per role, and the screens/actions added for stock count, returns, PDI and first-off.
-- The built-in roles already exist, so their lists are extended rather than replaced: edits made under Settings survive.

ALTER TABLE "AccessRole" ADD COLUMN "home" TEXT[];

UPDATE "AccessRole" SET "home" = ARRAY[]::TEXT[];

UPDATE "AccessRole" SET "views" = "views" || ARRAY['approvals'],
  "home" = ARRAY['plant-overview', 'approvals', 'needs-you', 'stock-health'] WHERE "key" = 'ADMIN';

UPDATE "AccessRole" SET "views" = "views" || ARRAY['count', 'returns', 'rtv'],
  "home" = ARRAY['needs-you', 'stock-health', 'quick-actions'] WHERE "key" = 'STORE_INCHARGE';

UPDATE "AccessRole" SET "views" = "views" || ARRAY['firstoff', 'pdi'], "permissions" = "permissions" || ARRAY['firstoff.approve'],
  "description" = 'Inward QC, first-off and final inspection, scrap decisions, traceability and alternate-grade approval.',
  "home" = ARRAY['qc-queue', 'needs-you'] WHERE "key" = 'QA_INSPECTOR';

UPDATE "AccessRole" SET "views" = "views" || ARRAY['returns', 'firstoff'], "permissions" = "permissions" || ARRAY['firstoff.request'],
  "home" = ARRAY['my-machines', 'needs-you', 'quick-actions'] WHERE "key" = 'PRODUCTION_LEAD';

UPDATE "AccessRole" SET "home" = ARRAY['todays-shipments', 'needs-you'] WHERE "key" = 'DISPATCH_OFFICER';
UPDATE "AccessRole" SET "home" = ARRAY['needs-you', 'stock-health'] WHERE "key" = 'PLANNER';
UPDATE "AccessRole" SET "home" = ARRAY['needs-you', 'plant-overview', 'approvals', 'qc-queue', 'my-machines', 'todays-shipments', 'stock-health', 'quick-actions'] WHERE "key" = 'DEMO';

-- Custom roles keep the task inbox they have today.
UPDATE "AccessRole" SET "home" = ARRAY['needs-you', 'stock-health'] WHERE "home" = ARRAY[]::TEXT[];
