-- Customer orders can be completed: a completed dispatch is allocated to the firm and spot lines it fulfils.
ALTER TABLE "DemandLine" ADD COLUMN "shippedQty" INTEGER NOT NULL DEFAULT 0;
