-- The quantity counted in staging at inward QC, kept beside the inspection.
ALTER TABLE "QcInspection" ADD COLUMN "countedQty" DECIMAL(14,3);
