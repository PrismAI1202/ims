-- CreateEnum
CREATE TYPE "BomLineKind" AS ENUM ('RESIN', 'MASTERBATCH', 'REGRIND', 'BOP', 'PACKAGING');

-- CreateEnum
CREATE TYPE "Shift" AS ENUM ('A', 'B', 'C');

-- CreateTable
CREATE TABLE "Bom" (
    "id" TEXT NOT NULL,
    "fgItemId" TEXT NOT NULL,
    "mouldId" TEXT NOT NULL,
    "partWeightG" DECIMAL(10,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLine" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "BomLineKind" NOT NULL,
    "pct" DECIMAL(7,3),
    "qtyPerPart" DECIMAL(12,4),

    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBooking" (
    "id" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "shift" "Shift" NOT NULL,
    "shots" INTEGER NOT NULL,
    "goodParts" INTEGER NOT NULL,
    "rejectParts" INTEGER NOT NULL DEFAULT 0,
    "runnerKg" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "regrindLotId" TEXT,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "note" TEXT,

    CONSTRAINT "ProductionBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingConsumption" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "expectedQty" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "BookingConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bom_fgItemId_key" ON "Bom"("fgItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBooking_bookingNumber_key" ON "ProductionBooking"("bookingNumber");

-- CreateIndex
CREATE INDEX "ProductionBooking_producedAt_idx" ON "ProductionBooking"("producedAt");

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_fgItemId_fkey" FOREIGN KEY ("fgItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_mouldId_fkey" FOREIGN KEY ("mouldId") REFERENCES "Mould"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBooking" ADD CONSTRAINT "ProductionBooking_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionBooking" ADD CONSTRAINT "ProductionBooking_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingConsumption" ADD CONSTRAINT "BookingConsumption_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ProductionBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingConsumption" ADD CONSTRAINT "BookingConsumption_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
