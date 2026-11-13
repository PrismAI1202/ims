-- CreateEnum
CREATE TYPE "PdiStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'RELEASED', 'HOLD');

-- AlterTable
ALTER TABLE "Lot" ADD COLUMN     "pdiAt" TIMESTAMP(3),
ADD COLUMN     "pdiById" TEXT,
ADD COLUMN     "pdiNote" TEXT,
ADD COLUMN     "pdiStatus" "PdiStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

