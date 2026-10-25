import { PrismaClient, Role, Segment, ItemCategory, LocationType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const users: { email: string; name: string; role: Role }[] = [
    { email: "admin@ims.local", name: "Admin", role: "ADMIN" },
    { email: "store@ims.local", name: "Store Incharge", role: "STORE_INCHARGE" },
    { email: "qa@ims.local", name: "QA Inspector", role: "QA_INSPECTOR" },
    { email: "production@ims.local", name: "Production Lead", role: "PRODUCTION_LEAD" },
    { email: "dispatch@ims.local", name: "Dispatch Officer", role: "DISPATCH_OFFICER" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash },
    });
  }

  const customers: { code: string; name: string; segment: Segment; labelFormat: string }[] = [
    { code: "CUST-AUTO", name: "Apex Motors (Tier-1)", segment: "AUTOMOTIVE", labelFormat: "OEM" },
    { code: "CUST-IND", name: "Bright Home Appliances", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC" },
  ];
  for (const c of customers) {
    await prisma.customer.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  const suppliers = [
    { code: "SUP-POLY", name: "PolyChem Industries", leadTimeDays: 10 },
    { code: "SUP-PACK", name: "PackRight Corrugates", leadTimeDays: 5 },
    { code: "SUP-INS", name: "Precision Inserts Ltd", leadTimeDays: 14 },
  ];
  for (const s of suppliers) {
    await prisma.supplier.upsert({ where: { code: s.code }, update: {}, create: s });
  }

  type SeedItem = {
    code: string; name: string; category: ItemCategory; uom?: string; polymerGrade?: string;
    minStock: number; reorderPoint: number; maxStock: number; safetyStock?: number;
    requiresCoa?: boolean; maxRegrindPct?: number; shelfLifeDays?: number;
  };
  const items: SeedItem[] = [
    { code: "RM-PP-001", name: "PP Homopolymer H110MA", category: "RM_RESIN", polymerGrade: "PP", minStock: 2000, reorderPoint: 4000, maxStock: 12000, safetyStock: 1000, requiresCoa: true, maxRegrindPct: 25 },
    { code: "RM-ABS-001", name: "ABS Natural Grade", category: "RM_RESIN", polymerGrade: "ABS", minStock: 1500, reorderPoint: 3000, maxStock: 9000, safetyStock: 750, requiresCoa: true, maxRegrindPct: 20 },
    { code: "RM-PA66-001", name: "PA66 GF30", category: "RM_RESIN", polymerGrade: "PA66", minStock: 1000, reorderPoint: 2000, maxStock: 6000, requiresCoa: true, maxRegrindPct: 15, shelfLifeDays: 365 },
    { code: "RM-PC-001", name: "Polycarbonate Clear", category: "RM_RESIN", polymerGrade: "PC", minStock: 800, reorderPoint: 1600, maxStock: 5000, requiresCoa: true, maxRegrindPct: 20 },
    { code: "RM-POM-001", name: "POM Acetal Copolymer", category: "RM_RESIN", polymerGrade: "POM", minStock: 600, reorderPoint: 1200, maxStock: 4000, maxRegrindPct: 20 },
    { code: "MB-BLK-001", name: "Black Masterbatch", category: "RM_MASTERBATCH", minStock: 100, reorderPoint: 200, maxStock: 600, shelfLifeDays: 540 },
    { code: "MB-GRY-001", name: "Grey Masterbatch", category: "RM_MASTERBATCH", minStock: 80, reorderPoint: 160, maxStock: 500, shelfLifeDays: 540 },
    { code: "BOP-INS-M6", name: "Brass Insert M6", category: "BOP", uom: "NOS", minStock: 5000, reorderPoint: 10000, maxStock: 40000 },
    { code: "BOP-CLP-01", name: "Steel Clip 12mm", category: "BOP", uom: "NOS", minStock: 3000, reorderPoint: 6000, maxStock: 25000 },
    { code: "PK-BOX-5P", name: "Corrugated Box 5-ply 400x300", category: "PACKAGING", uom: "NOS", minStock: 500, reorderPoint: 1000, maxStock: 4000 },
    { code: "PK-FILM-01", name: "Stretch Film Roll", category: "PACKAGING", uom: "ROLL", minStock: 20, reorderPoint: 40, maxStock: 150 },
    { code: "PK-CRATE-A", name: "Returnable Crate (Apex Motors)", category: "RETURNABLE", uom: "NOS", minStock: 200, reorderPoint: 400, maxStock: 1500 },
    { code: "RG-PP-001", name: "PP Regrind (in-house)", category: "REGRIND", polymerGrade: "PP", minStock: 0, reorderPoint: 0, maxStock: 0 },
    { code: "RG-ABS-001", name: "ABS Regrind (in-house)", category: "REGRIND", polymerGrade: "ABS", minStock: 0, reorderPoint: 0, maxStock: 0 },
    { code: "FG-CLIP-001", name: "Dashboard Clip (finished)", category: "FG", uom: "NOS", minStock: 2000, reorderPoint: 4000, maxStock: 20000 },
  ];
  for (const i of items) {
    await prisma.item.upsert({
      where: { code: i.code },
      update: {},
      create: {
        code: i.code, name: i.name, category: i.category, uom: i.uom ?? "KG",
        polymerGrade: i.polymerGrade, minStock: i.minStock, reorderPoint: i.reorderPoint,
        maxStock: i.maxStock, safetyStock: i.safetyStock ?? 0,
        requiresCoa: i.requiresCoa ?? false, maxRegrindPct: i.maxRegrindPct,
        shelfLifeDays: i.shelfLifeDays,
      },
    });
  }

  // Default prices
  const poly = await prisma.supplier.findUniqueOrThrow({ where: { code: "SUP-POLY" } });
  const pack = await prisma.supplier.findUniqueOrThrow({ where: { code: "SUP-PACK" } });
  const ins = await prisma.supplier.findUniqueOrThrow({ where: { code: "SUP-INS" } });
  const priceFor: Record<string, [string, number]> = {
    "RM-PP-001": [poly.id, 112], "RM-ABS-001": [poly.id, 168], "RM-PA66-001": [poly.id, 310],
    "RM-PC-001": [poly.id, 245], "RM-POM-001": [poly.id, 220], "MB-BLK-001": [poly.id, 260],
    "MB-GRY-001": [poly.id, 255], "BOP-INS-M6": [ins.id, 3.2], "BOP-CLP-01": [ins.id, 1.8],
    "PK-BOX-5P": [pack.id, 42], "PK-FILM-01": [pack.id, 380], "PK-CRATE-A": [pack.id, 450],
  };
  for (const [code, [supplierId, price]] of Object.entries(priceFor)) {
    const item = await prisma.item.findUniqueOrThrow({ where: { code } });
    await prisma.priceMaster.upsert({
      where: { itemId_supplierId: { itemId: item.id, supplierId } },
      update: {},
      create: { itemId: item.id, supplierId, price },
    });
  }

  // Warehouse + locations (one staging area for inward, racks for storage)
  const wh = await prisma.warehouse.upsert({
    where: { code: "WH-MAIN" }, update: {}, create: { code: "WH-MAIN", name: "Main Store" },
  });
  const locs: { code: string; rack: string; shelf: string; bin: string; type: LocationType }[] = [
    { code: "STG-01", rack: "STG", shelf: "01", bin: "01", type: "STAGING" },
  ];
  for (const rack of ["A", "B", "C"]) {
    for (const shelf of ["01", "02"]) {
      for (const bin of ["01", "02", "03"]) {
        locs.push({ code: `${rack}-${shelf}-${bin}`, rack, shelf, bin, type: "STORAGE" });
      }
    }
  }
  for (const l of locs) {
    await prisma.location.upsert({
      where: { code: l.code }, update: {}, create: { ...l, warehouseId: wh.id },
    });
  }

  // Machines and moulds
  const m1 = await prisma.machine.upsert({ where: { code: "IMM-01" }, update: {}, create: { code: "IMM-01", name: "Injection Machine 90T", tonnage: 90 } });
  await prisma.machine.upsert({ where: { code: "IMM-02" }, update: {}, create: { code: "IMM-02", name: "Injection Machine 150T", tonnage: 150 } });
  await prisma.mould.upsert({
    where: { code: "MLD-1001" }, update: {},
    create: { code: "MLD-1001", name: "Dashboard Clip Mould", cavities: 4, shotWeightG: 38.5, runnerWeightG: 6.2, machineId: m1.id },
  });

  // Sample tax details so challans / e-way data can be shown complete. Replace with real values.
  await prisma.item.update({ where: { code: "FG-CLIP-001" }, data: { hsnCode: "39269099", unitPrice: 4.25 } });
  await prisma.customer.update({
    where: { code: "CUST-AUTO" },
    data: { gstin: "27AAAAA0000A1Z5", address: "Plot 12, MIDC Chakan, Pune, Maharashtra" },
  });
  await prisma.customer.update({
    where: { code: "CUST-IND" },
    data: { gstin: "27BBBBB1111B1Z6", address: "Industrial Estate, Nashik, Maharashtra" },
  });

  // The seeded crate belongs to the customer, so it is tracked in the returnable ledger only.
  await prisma.item.update({ where: { code: "PK-CRATE-A" }, data: { stockTracked: false } });

  // Demo BOM: 4-cavity clip, 70% PP + 5% black masterbatch + 25% PP regrind, two brass inserts per part.
  const fg = await prisma.item.findUniqueOrThrow({ where: { code: "FG-CLIP-001" } });
  if (!(await prisma.bom.findUnique({ where: { fgItemId: fg.id } }))) {
    const mould = await prisma.mould.findUniqueOrThrow({ where: { code: "MLD-1001" } });
    const id = async (code: string) => (await prisma.item.findUniqueOrThrow({ where: { code } })).id;
    await prisma.bom.create({
      data: {
        fgItemId: fg.id, mouldId: mould.id, partWeightG: 8.5,
        lines: {
          create: [
            { itemId: await id("RM-PP-001"), kind: "RESIN", pct: 70 },
            { itemId: await id("MB-BLK-001"), kind: "MASTERBATCH", pct: 5 },
            { itemId: await id("RG-PP-001"), kind: "REGRIND", pct: 25 },
            { itemId: await id("BOP-INS-M6"), kind: "BOP", qtyPerPart: 2 },
          ],
        },
      },
    });
  }

  console.log("Seed complete. Login: <role>@ims.local / password123");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
