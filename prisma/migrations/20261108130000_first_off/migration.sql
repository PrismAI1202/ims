-- CreateEnum
CREATE TYPE "FirstOffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "FirstOff" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "shift" "Shift" NOT NULL,
    "status" "FirstOffStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirstOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FirstOff_machineId_bomId_status_idx" ON "FirstOff"("machineId", "bomId", "status");

-- CreateIndex
CREATE INDEX "FirstOff_status_idx" ON "FirstOff"("status");

-- AddForeignKey
ALTER TABLE "FirstOff" ADD CONSTRAINT "FirstOff_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirstOff" ADD CONSTRAINT "FirstOff_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

