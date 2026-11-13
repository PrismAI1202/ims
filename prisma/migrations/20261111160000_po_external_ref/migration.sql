-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "externalRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_supplierId_externalRef_key" ON "PurchaseOrder"("supplierId", "externalRef");

