-- CreateEnum
CREATE TYPE "BoxStatus" AS ENUM ('IN_STOCK', 'DISPATCHED');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('LOADING', 'DISPATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnableMove" AS ENUM ('ISSUED', 'RETURNED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "address" TEXT,
ADD COLUMN     "gstin" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "unitPrice" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "ProductionBooking" ADD COLUMN     "fgLotId" TEXT;

-- CreateTable
CREATE TABLE "FgBox" (
    "id" TEXT NOT NULL,
    "boxCode" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "shift" TEXT,
    "machineCode" TEXT,
    "batchCode" TEXT,
    "producedDate" TIMESTAMP(3) NOT NULL,
    "status" "BoxStatus" NOT NULL DEFAULT 'IN_STOCK',
    "dispatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FgBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "dcNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "driverName" TEXT,
    "status" "DispatchStatus" NOT NULL DEFAULT 'LOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchLine" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "DispatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnableLedger" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "move" "ReturnableMove" NOT NULL,
    "qty" INTEGER NOT NULL,
    "dispatchId" TEXT,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnableLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FgBox_boxCode_key" ON "FgBox"("boxCode");

-- CreateIndex
CREATE INDEX "FgBox_lotId_status_idx" ON "FgBox"("lotId", "status");

-- CreateIndex
CREATE INDEX "FgBox_dispatchId_idx" ON "FgBox"("dispatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_dcNumber_key" ON "Dispatch"("dcNumber");

-- CreateIndex
CREATE INDEX "ReturnableLedger_customerId_itemId_idx" ON "ReturnableLedger"("customerId", "itemId");

-- AddForeignKey
ALTER TABLE "FgBox" ADD CONSTRAINT "FgBox_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FgBox" ADD CONSTRAINT "FgBox_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FgBox" ADD CONSTRAINT "FgBox_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FgBox" ADD CONSTRAINT "FgBox_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchLine" ADD CONSTRAINT "DispatchLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnableLedger" ADD CONSTRAINT "ReturnableLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnableLedger" ADD CONSTRAINT "ReturnableLedger_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnableLedger" ADD CONSTRAINT "ReturnableLedger_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
