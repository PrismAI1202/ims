-- A PO can ask the supplier to expedite: flagged when the wanted date is inside the supplier's lead time.
ALTER TABLE "PurchaseOrder" ADD COLUMN "expedite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrder" ADD COLUMN "expediteNote" TEXT;
