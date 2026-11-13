-- The customer's own PO number on an order line, so lines of one customer PO can be found together.
ALTER TABLE "DemandLine" ADD COLUMN "customerRef" TEXT;
CREATE INDEX "DemandLine_customerId_customerRef_idx" ON "DemandLine"("customerId", "customerRef");
