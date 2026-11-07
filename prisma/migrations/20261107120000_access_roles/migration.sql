-- Roles move from a fixed enum to a table an admin can edit (Settings · Roles & access).
-- Existing users keep their role key; the enum's five values become system roles, plus Planner and Demo.

-- CreateTable
CREATE TABLE "AccessRole" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "allAccess" BOOLEAN NOT NULL DEFAULT false,
    "views" TEXT[],
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_name_key" ON "AccessRole"("name");

-- System roles (generated from SYSTEM_ROLES in src/server/auth/permissions.ts)
INSERT INTO "AccessRole" ("key", "name", "description", "system", "allAccess", "views", "permissions", "updatedAt") VALUES
  ('ADMIN', 'Admin', 'Plant head and system owner: set-up, users and roles, exceptions and KPIs.', true, false, ARRAY['process', 'orders', 'metrics', 'masters', 'users', 'settings', 'partners', 'bom', 'equivalents', 'maintenance', 'trace', 'variance']::TEXT[], ARRAY['reorder.view', 'equivalents.manage']::TEXT[], CURRENT_TIMESTAMP),
  ('STORE_INCHARGE', 'Store Incharge', 'Receives trucks, puts away approved lots, issues material FIFO and raises POs.', true, false, ARRAY['grn', 'stock', 'issue', 'scan', 'purchase', 'mrp']::TEXT[], ARRAY['reorder.view', 'stock.transfer']::TEXT[], CURRENT_TIMESTAMP),
  ('QA_INSPECTOR', 'QA Inspector', 'Inward QC, scrap decisions, traceability and alternate-grade approval.', true, false, ARRAY['qc', 'scrap', 'trace', 'equivalents']::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('PRODUCTION_LEAD', 'Production Lead', 'Runs the machines: requests material, books shifts and downtime, packs FG, logs maintenance.', true, false, ARRAY['production', 'requests', 'fg', 'planning', 'maintenance']::TEXT[], ARRAY['downtime.log', 'maintenance.manage']::TEXT[], CURRENT_TIMESTAMP),
  ('DISPATCH_OFFICER', 'Dispatch Officer', 'Picks and loads FG boxes, prints the DC and e-way data, keeps the returnable ledger.', true, false, ARRAY['dispatch', 'fg', 'returnables', 'scan']::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('PLANNER', 'Planner', 'Imports customer demand, runs MRP, releases POs and plans moulds on machines.', true, false, ARRAY['demand', 'mrp', 'purchase', 'planning', 'orders', 'partners']::TEXT[], ARRAY['reorder.view', 'plan.manage']::TEXT[], CURRENT_TIMESTAMP),
  ('DEMO', 'Demo (all views)', 'Every screen and action, for walkthroughs. Not for day-to-day use.', true, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP);

-- User.role: enum -> text key of AccessRole
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
DROP TYPE "Role";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_role_fkey" FOREIGN KEY ("role") REFERENCES "AccessRole"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
