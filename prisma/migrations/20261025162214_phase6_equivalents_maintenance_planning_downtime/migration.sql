-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('PENDING_QA', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DowntimeReason" AS ENUM ('MOULD_CHANGE', 'MOULD_REPAIR', 'MACHINE_BREAKDOWN', 'NO_MATERIAL', 'NO_OPERATOR', 'NO_PLAN', 'POWER_CUT', 'QC_HOLD', 'COLOUR_CHANGE', 'TRIAL');

-- CreateEnum
CREATE TYPE "RepairKind" AS ENUM ('REPAIR', 'TRIAL');

-- CreateEnum
CREATE TYPE "PlanKind" AS ENUM ('JOB', 'PM', 'TRIAL');

-- AlterTable
ALTER TABLE "Mould" ADD COLUMN     "idealCycleSec" DECIMAL(7,2),
ADD COLUMN     "lastPmShots" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lifeShots" INTEGER NOT NULL DEFAULT 1000000,
ADD COLUMN     "minTonnage" INTEGER,
ADD COLUMN     "openingShots" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pmIntervalShots" INTEGER NOT NULL DEFAULT 50000;

-- CreateTable
CREATE TABLE "EquivalentGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "spec" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquivalentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquivalentGrade" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "gradeName" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "GradeStatus" NOT NULL DEFAULT 'PENDING_QA',
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "leadTimeDays" INTEGER,
    "datasheetRef" TEXT,
    "trialRef" TEXT,
    "note" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquivalentGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Downtime" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "mouldId" TEXT,
    "day" DATE NOT NULL,
    "shift" "Shift" NOT NULL,
    "reason" "DowntimeReason" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Downtime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmRecord" (
    "id" TEXT NOT NULL,
    "mouldId" TEXT NOT NULL,
    "shotsAtPm" INTEGER NOT NULL,
    "checks" TEXT NOT NULL,
    "photoRef" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairTicket" (
    "id" TEXT NOT NULL,
    "mouldId" TEXT NOT NULL,
    "kind" "RepairKind" NOT NULL DEFAULT 'REPAIR',
    "summary" TEXT NOT NULL,
    "downtimeMin" INTEGER NOT NULL DEFAULT 0,
    "photoRef" TEXT,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSlot" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" "PlanKind" NOT NULL DEFAULT 'JOB',
    "mouldId" TEXT,
    "fgItemId" TEXT,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "EquivalentGroup_code_key" ON "EquivalentGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EquivalentGroup_itemId_key" ON "EquivalentGroup"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "EquivalentGrade_groupId_gradeName_supplierId_key" ON "EquivalentGrade"("groupId", "gradeName", "supplierId");

-- CreateIndex
CREATE INDEX "Downtime_day_idx" ON "Downtime"("day");

-- CreateIndex
CREATE INDEX "Downtime_machineId_day_idx" ON "Downtime"("machineId", "day");

-- CreateIndex
CREATE INDEX "PmRecord_mouldId_createdAt_idx" ON "PmRecord"("mouldId", "createdAt");

-- CreateIndex
CREATE INDEX "RepairTicket_mouldId_createdAt_idx" ON "RepairTicket"("mouldId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanSlot_day_idx" ON "PlanSlot"("day");

-- CreateIndex
CREATE UNIQUE INDEX "PlanSlot_machineId_day_key" ON "PlanSlot"("machineId", "day");

-- AddForeignKey
ALTER TABLE "EquivalentGroup" ADD CONSTRAINT "EquivalentGroup_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquivalentGrade" ADD CONSTRAINT "EquivalentGrade_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EquivalentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquivalentGrade" ADD CONSTRAINT "EquivalentGrade_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Downtime" ADD CONSTRAINT "Downtime_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Downtime" ADD CONSTRAINT "Downtime_mouldId_fkey" FOREIGN KEY ("mouldId") REFERENCES "Mould"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmRecord" ADD CONSTRAINT "PmRecord_mouldId_fkey" FOREIGN KEY ("mouldId") REFERENCES "Mould"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairTicket" ADD CONSTRAINT "RepairTicket_mouldId_fkey" FOREIGN KEY ("mouldId") REFERENCES "Mould"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSlot" ADD CONSTRAINT "PlanSlot_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSlot" ADD CONSTRAINT "PlanSlot_mouldId_fkey" FOREIGN KEY ("mouldId") REFERENCES "Mould"("id") ON DELETE SET NULL ON UPDATE CASCADE;
