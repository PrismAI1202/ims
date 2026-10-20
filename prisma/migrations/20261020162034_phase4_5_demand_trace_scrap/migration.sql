-- CreateEnum
CREATE TYPE "DemandType" AS ENUM ('FORECAST', 'FIRM', 'SPOT');

-- CreateEnum
CREATE TYPE "ScrapKind" AS ENUM ('REGRIND', 'WASTE');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "stockTracked" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DemandImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "replaced" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT,
    "customerId" TEXT NOT NULL,
    "fgItemId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "qty" INTEGER NOT NULL,
    "type" "DemandType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionLotUse" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "ProductionLotUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapDisposition" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "parts" INTEGER NOT NULL,
    "weightKg" DECIMAL(12,3) NOT NULL,
    "kind" "ScrapKind" NOT NULL,
    "regrindLotId" TEXT,
    "note" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapDisposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemandLine_dueDate_idx" ON "DemandLine"("dueDate");

-- CreateIndex
CREATE INDEX "DemandLine_customerId_fgItemId_type_idx" ON "DemandLine"("customerId", "fgItemId", "type");

-- CreateIndex
CREATE INDEX "ProductionLotUse_lotId_idx" ON "ProductionLotUse"("lotId");

-- CreateIndex
CREATE INDEX "ProductionLotUse_bookingId_idx" ON "ProductionLotUse"("bookingId");

-- CreateIndex
CREATE INDEX "ScrapDisposition_bookingId_idx" ON "ScrapDisposition"("bookingId");

-- AddForeignKey
ALTER TABLE "DemandLine" ADD CONSTRAINT "DemandLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DemandImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandLine" ADD CONSTRAINT "DemandLine_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandLine" ADD CONSTRAINT "DemandLine_fgItemId_fkey" FOREIGN KEY ("fgItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLotUse" ADD CONSTRAINT "ProductionLotUse_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ProductionBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLotUse" ADD CONSTRAINT "ProductionLotUse_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapDisposition" ADD CONSTRAINT "ScrapDisposition_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ProductionBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
