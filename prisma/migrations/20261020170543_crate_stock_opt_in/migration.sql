-- AlterTable
ALTER TABLE "Item" ALTER COLUMN "stockTracked" SET DEFAULT false;

-- Crate stock tracking is opt-in: rows created while it defaulted to on must not suddenly start blocking dispatches.
UPDATE "Item" SET "stockTracked" = false;
