-- AlterEnum
ALTER TYPE "TxnType" ADD VALUE 'RTV_OUT';

-- CreateTable
CREATE TABLE "ReturnToVendor" (
    "id" TEXT NOT NULL,
    "rtvNumber" TEXT NOT NULL,
    "debitNoteNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnToVendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnToVendor_rtvNumber_key" ON "ReturnToVendor"("rtvNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnToVendor_debitNoteNumber_key" ON "ReturnToVendor"("debitNoteNumber");

-- CreateIndex
CREATE INDEX "ReturnToVendor_lotId_idx" ON "ReturnToVendor"("lotId");

-- AddForeignKey
ALTER TABLE "ReturnToVendor" ADD CONSTRAINT "ReturnToVendor_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnToVendor" ADD CONSTRAINT "ReturnToVendor_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

