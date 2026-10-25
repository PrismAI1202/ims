// Demo data that mirrors the examples in the Claude Design mock-ups (parts DT-220 / HX-14 / BZ-31 / CP-08 / HS-40,
// Vendors A–G, the placeholder customers, machines M-01…M-11). Additive and safe to re-run: it does nothing if the
// demo stock already exists. Everything goes through the real services, so ledgers, lots and traceability stay consistent.
//
//   npm run db:seed        # base users, bins and master data (run first)
//   npm run db:seed:demo   # this file
import { PrismaClient, type ItemCategory, type Segment } from "@prisma/client";
import { createPurchaseOrder, createGrn, recordQc, createMaterialRequest, issueStock, DomainError } from "../src/server/services/inventory";
import { saveBom, bookProduction } from "../src/server/services/production";
import { packBoxes } from "../src/server/services/fg";
import { createDispatch, scanBox, completeDispatch, recordReturnable } from "../src/server/services/dispatch";
import { importDemand } from "../src/server/services/demand";

const prisma = new PrismaClient();

const SUPPLIERS = [
  { code: "SUP-003", name: "Vendor A", leadTimeDays: 7 }, { code: "SUP-007", name: "Vendor B", leadTimeDays: 12 },
  { code: "SUP-011", name: "Vendor C", leadTimeDays: 4 }, { code: "SUP-004", name: "Vendor D", leadTimeDays: 5 },
  { code: "SUP-015", name: "Vendor E", leadTimeDays: 6 }, { code: "SUP-009", name: "Vendor F", leadTimeDays: 10 },
  { code: "SUP-018", name: "Vendor G", leadTimeDays: 14 },
];
const CUSTOMERS: { code: string; name: string; segment: Segment; labelFormat: string; gstin: string; address: string }[] = [
  { code: "CUS-001", name: "[OEM CUSTOMER A]", segment: "AUTOMOTIVE", labelFormat: "OEM", gstin: "27AAAAA0001A1Z5", address: "[ADDRESS A]" },
  { code: "CUS-014", name: "[CUSTOMER B]", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC", gstin: "27BBBBB0014B1Z6", address: "[ADDRESS B]" },
  { code: "CUS-022", name: "[TIER-1 CUSTOMER C]", segment: "AUTOMOTIVE", labelFormat: "OEM", gstin: "27CCCCC0022C1Z7", address: "[ADDRESS C]" },
  { code: "CUS-031", name: "[CUSTOMER D]", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC", gstin: "27DDDDD0031D1Z8", address: "[ADDRESS D]" },
];
const MACHINES: [string, number][] = [["M-01", 80], ["M-03", 120], ["M-05", 150], ["M-07", 180], ["M-09", 250], ["M-11", 350]];
// code, name, cavities, part weight g, runner g, machine
const MOULDS: [string, string, number, number, number, string][] = [
  ["MD-118", "Door trim clip mould", 4, 6.2, 3.1, "M-07"], ["MD-090", "Handle mould", 2, 38, 8, "M-03"], ["MD-131", "Bezel mould", 2, 22, 5, "M-05"],
  ["MD-052", "Cap mould", 8, 3.5, 4, "M-01"], ["MD-201", "Housing mould", 1, 310, 18, "M-09"],
];

type ItemSpec = {
  code: string; name: string; category: ItemCategory; uom?: string; grade?: string; min: number; rop: number; max: number;
  coa?: boolean; regrind?: number; hsn?: string; price?: number; tracked?: boolean;
};
const ITEMS: ItemSpec[] = [
  { code: "RM-PP-012", name: "PP Homopolymer MFI 12", category: "RM_RESIN", grade: "PP", min: 2000, rop: 2600, max: 4000, coa: true, regrind: 20 },
  { code: "RM-ABS-NAT", name: "ABS natural", category: "RM_RESIN", grade: "ABS", min: 1000, rop: 1500, max: 3500, coa: true, regrind: 30 },
  { code: "RM-PA66-G30", name: "PA66 GF30", category: "RM_RESIN", grade: "PA66", min: 800, rop: 1200, max: 2500, coa: true, regrind: 15 },
  { code: "RM-POM-C", name: "POM copolymer", category: "RM_RESIN", grade: "POM", min: 400, rop: 700, max: 1500, coa: true, regrind: 10 },
  { code: "MB-BLK-40", name: "Black masterbatch 40%", category: "RM_MASTERBATCH", min: 100, rop: 150, max: 400 },
  { code: "MB-GRY-7035", name: "Grey MB RAL 7035", category: "RM_MASTERBATCH", min: 60, rop: 100, max: 250 },
  { code: "RG-PA66-001", name: "PA66 regrind (in-house)", category: "REGRIND", grade: "PA66", min: 0, rop: 0, max: 0 },
  { code: "RG-POM-001", name: "POM regrind (in-house)", category: "REGRIND", grade: "POM", min: 0, rop: 0, max: 0 },
  { code: "BOP-INS-M4K", name: "Brass insert M4 knurled", category: "BOP", uom: "NOS", min: 40000, rop: 60000, max: 150000 },
  { code: "BOP-CLIP-SC3", name: "Steel spring clip SC-3", category: "BOP", uom: "NOS", min: 10000, rop: 15000, max: 40000 },
  { code: "PK-BOX-4030", name: "Corrugated box 400×300", category: "PACKAGING", uom: "NOS", min: 300, rop: 450, max: 1200 },
  { code: "PK-FILM-23", name: "Stretch film", category: "PACKAGING", uom: "ROLL", min: 10, rop: 14, max: 40 },
  { code: "PK-CRATE-RB600", name: "Returnable crate RB-600", category: "RETURNABLE", uom: "NOS", min: 0, rop: 0, max: 0, tracked: false },
  { code: "FG-DT220", name: "DT-220 Door trim clip", category: "FG", uom: "NOS", min: 8000, rop: 12000, max: 30000, hsn: "87082900", price: 12.5 },
  { code: "FG-HX14", name: "HX-14 Handle", category: "FG", uom: "NOS", min: 2500, rop: 3000, max: 8000, hsn: "39269099", price: 38 },
  { code: "FG-BZ31", name: "BZ-31 Bezel", category: "FG", uom: "NOS", min: 1000, rop: 2000, max: 6000, hsn: "87082900", price: 46 },
  { code: "FG-CP08", name: "CP-08 Cap", category: "FG", uom: "NOS", min: 3000, rop: 5000, max: 20000, hsn: "39235090", price: 3.2 },
  { code: "FG-HS40", name: "HS-40 Housing", category: "FG", uom: "NOS", min: 500, rop: 1000, max: 4000, hsn: "85389000", price: 410 },
];
const PRICES: Record<string, [string, number]> = {
  "RM-PP-012": ["SUP-003", 112], "RM-ABS-NAT": ["SUP-003", 168], "RM-PA66-G30": ["SUP-003", 310], "RM-POM-C": ["SUP-003", 220],
  "MB-BLK-40": ["SUP-004", 260], "MB-GRY-7035": ["SUP-015", 255], "BOP-INS-M4K": ["SUP-009", 3.2], "BOP-CLIP-SC3": ["SUP-009", 1.8],
  "PK-BOX-4030": ["SUP-011", 42], "PK-FILM-23": ["SUP-011", 380],
};

// item, supplier, bin (null = left pending QC in staging), received qty, supplier lot / heat no., quantity issued to the floor afterwards
type LotSpec = { item: string; sup: string; bin: string | null; qty: number; heat: string; issued?: number };
const LOTS: LotSpec[] = [
  { item: "RM-PP-012", sup: "SUP-003", bin: "A-01-01", qty: 1000, heat: "H110-7731", issued: 120 },
  { item: "RM-PP-012", sup: "SUP-007", bin: "A-01-02", qty: 550, heat: "PH12N-55850" },
  { item: "RM-PP-012", sup: "SUP-011", bin: "A-01-03", qty: 410, heat: "1200MC-2201" },
  { item: "RM-ABS-NAT", sup: "SUP-003", bin: "B-01-01", qty: 2000, heat: "AB2231", issued: 100 },
  { item: "RM-ABS-NAT", sup: "SUP-007", bin: "B-01-02", qty: 1000, heat: "ABS750-118" },
  { item: "RM-PA66-G30", sup: "SUP-003", bin: "B-02-01", qty: 700, heat: "PG-118" },
  { item: "RM-PA66-G30", sup: "SUP-007", bin: "B-02-02", qty: 450, heat: "A3GF30-77" },
  { item: "RM-POM-C", sup: "SUP-003", bin: "B-02-03", qty: 650, heat: "POMC27-9" },
  { item: "MB-BLK-40", sup: "SUP-004", bin: "C-01-01", qty: 300, heat: "BK4021-L77", issued: 40 },
  { item: "MB-BLK-40", sup: "SUP-015", bin: "C-01-02", qty: 50, heat: "CB40-12" },
  { item: "MB-GRY-7035", sup: "SUP-015", bin: "C-01-03", qty: 95, heat: "GR7035-12" },
  { item: "BOP-INS-M4K", sup: "SUP-009", bin: "C-02-01", qty: 12000, heat: "INSM4K-B14" },
  { item: "BOP-CLIP-SC3", sup: "SUP-009", bin: "C-02-02", qty: 14000, heat: "SC3-2210" },
  { item: "PK-BOX-4030", sup: "SUP-011", bin: "C-02-03", qty: 420, heat: "BX-0418" },
  { item: "PK-FILM-23", sup: "SUP-011", bin: "C-02-03", qty: 8, heat: "FILM-23-6" },
  // Arrived but not yet through QC: these show as "QC hold" in the staging area of the bin map.
  { item: "RM-ABS-NAT", sup: "SUP-003", bin: null, qty: 1000, heat: "AB-2240" },
  { item: "RM-PP-012", sup: "SUP-007", bin: null, qty: 1000, heat: "PH12N-55821" },
];

async function main() {
  const user = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const [admin, store, qa, prod, disp] = await Promise.all([
    user("admin@ims.local"), user("store@ims.local"), user("qa@ims.local"), user("production@ims.local"), user("dispatch@ims.local"),
  ]);

  if (await prisma.lot.findFirst({ where: { item: { code: "RM-PP-012" } } })) {
    console.log("Demo stock already loaded; nothing to do.");
    return;
  }

  // ── Masters ──
  for (const s of SUPPLIERS) await prisma.supplier.upsert({ where: { code: s.code }, update: {}, create: s });
  for (const c of CUSTOMERS) await prisma.customer.upsert({ where: { code: c.code }, update: {}, create: c });
  const wh = await prisma.warehouse.findFirstOrThrow();
  for (const shelf of ["01", "02"]) {
    for (const bin of ["01", "02", "03"]) {
      const code = `D-${shelf}-${bin}`;
      await prisma.location.upsert({ where: { code }, update: {}, create: { code, rack: "D", shelf, bin, type: "STORAGE", warehouseId: wh.id } });
    }
  }
  for (const [code, tonnage] of MACHINES) {
    await prisma.machine.upsert({ where: { code }, update: {}, create: { code, name: `Injection Machine ${tonnage}T`, tonnage } });
  }
  const machineId = async (code: string) => (await prisma.machine.findUniqueOrThrow({ where: { code } })).id;
  for (const [code, name, cavities, partG, runG, m] of MOULDS) {
    await prisma.mould.upsert({
      where: { code }, update: {},
      create: { code, name, cavities, shotWeightG: partG * cavities, runnerWeightG: runG, machineId: await machineId(m) },
    });
  }
  for (const i of ITEMS) {
    await prisma.item.upsert({
      where: { code: i.code }, update: {},
      create: {
        code: i.code, name: i.name, category: i.category, uom: i.uom ?? "KG", polymerGrade: i.grade,
        minStock: i.min, reorderPoint: i.rop, maxStock: i.max, requiresCoa: i.coa ?? false, maxRegrindPct: i.regrind,
        hsnCode: i.hsn, unitPrice: i.price, ...(i.tracked === false ? { stockTracked: false } : {}),
      },
    });
  }
  const sup = async (code: string) => (await prisma.supplier.findUniqueOrThrow({ where: { code } })).id;
  const item = async (code: string) => (await prisma.item.findUniqueOrThrow({ where: { code } })).id;
  for (const [code, [s, price]] of Object.entries(PRICES)) {
    const itemId = await item(code); const supplierId = await sup(s);
    await prisma.priceMaster.upsert({ where: { itemId_supplierId: { itemId, supplierId } }, update: {}, create: { itemId, supplierId, price } });
  }

  // ── Open supplier POs shown as "on order" in the design ──
  await createPurchaseOrder({ supplierId: await sup("SUP-003"), segment: "AUTOMOTIVE", userId: store,
    lines: [{ itemId: await item("RM-PP-012"), qty: 1000, expectedDate: new Date(Date.now() + 7 * 86_400_000) }] });
  await createPurchaseOrder({ supplierId: await sup("SUP-009"), segment: "AUTOMOTIVE", userId: store,
    lines: [{ itemId: await item("BOP-INS-M4K"), qty: 80000, expectedDate: new Date(Date.now() + 4 * 86_400_000) }] });

  // ── Receive, inspect and put away every lot ──
  const lotNo = new Map<string, string>(); // supplier lot -> internal lot number
  const poFor = new Map<string, Awaited<ReturnType<typeof createPurchaseOrder>>>();
  for (const l of LOTS) {
    const key = `${l.item}|${l.sup}`;
    if (!poFor.has(key)) {
      const total = LOTS.filter((x) => `${x.item}|${x.sup}` === key).reduce((a, x) => a + x.qty, 0);
      const spec = ITEMS.find((i) => i.code === l.item)!;
      poFor.set(key, await createPurchaseOrder({
        supplierId: await sup(l.sup), segment: spec.coa ? "AUTOMOTIVE" : "NON_AUTOMOTIVE", userId: store,
        lines: [{ itemId: await item(l.item), qty: total }],
      }));
    }
    const po = poFor.get(key)!;
    const grn = await createGrn({
      poId: po.id, vehicleNumber: "[VEHICLE NO.]", invoiceNumber: `INV/${l.heat}`, userId: store,
      coaUrl: ITEMS.find((i) => i.code === l.item)!.coa ? `COA-${l.heat}` : undefined,
      lines: [{ poLineId: po.lines[0].id, qty: l.qty, supplierLotNo: l.heat, bags: l.item.startsWith("RM-") ? Math.round(l.qty / 25) : undefined }],
    });
    const lot = await prisma.lot.findFirstOrThrow({ where: { grnLine: { grnId: grn.id } } });
    lotNo.set(l.heat, lot.lotNumber);
    if (l.bin) {
      await recordQc({ lotId: lot.id, decision: "APPROVED", mfi: 12.2, moisturePct: 0.03, density: 0.905, putawayLocationCode: l.bin, userId: qa });
    }
  }

  // ── Some stock already issued to the floor (makes bins "Part" on the bin map) ──
  for (const l of LOTS.filter((x) => x.issued)) {
    const req = await createMaterialRequest({ machineId: await machineId("M-07"), lines: [{ itemId: await item(l.item), qty: l.issued! }], userId: prod });
    const line = await prisma.materialRequestLine.findFirstOrThrow({ where: { requestId: req.id } });
    await issueStock({ requestLineId: line.id, lotNumber: lotNo.get(l.heat)!, locationCode: l.bin!, qty: l.issued!, userId: store });
  }
  // …and open requisitions waiting for the store (as on the design's FIFO screen).
  for (const [m, code, qty] of [["M-07", "RM-PP-012", 42], ["M-03", "MB-GRY-7035", 2], ["M-05", "BOP-INS-M4K", 2000]] as const) {
    await createMaterialRequest({ machineId: await machineId(m), lines: [{ itemId: await item(code), qty }], userId: prod });
  }

  // ── BOMs (virgin / regrind / masterbatch blends from the design) ──
  const mould = async (code: string) => (await prisma.mould.findUniqueOrThrow({ where: { code } })).id;
  const L = async (code: string, kind: "RESIN" | "MASTERBATCH" | "REGRIND", pct: number) => ({ itemId: await item(code), kind, pct });
  const Q = async (code: string, kind: "BOP" | "PACKAGING", qtyPerPart: number) => ({ itemId: await item(code), kind, qtyPerPart });
  const boms = [
    { fg: "FG-DT220", mould: "MD-118", w: 6.2, lines: [await L("RM-PP-012", "RESIN", 82), await L("RG-PP-001", "REGRIND", 15), await L("MB-BLK-40", "MASTERBATCH", 3), await Q("BOP-INS-M4K", "BOP", 2), await Q("PK-BOX-4030", "PACKAGING", 0.004)] },
    { fg: "FG-HX14", mould: "MD-090", w: 38, lines: [await L("RM-ABS-NAT", "RESIN", 68), await L("RG-ABS-001", "REGRIND", 30), await L("MB-GRY-7035", "MASTERBATCH", 2), await Q("PK-BOX-4030", "PACKAGING", 0.02)] },
    { fg: "FG-BZ31", mould: "MD-131", w: 22, lines: [await L("RM-PA66-G30", "RESIN", 87), await L("RG-PA66-001", "REGRIND", 10), await L("MB-BLK-40", "MASTERBATCH", 3), await Q("BOP-CLIP-SC3", "BOP", 1)] },
    { fg: "FG-CP08", mould: "MD-052", w: 3.5, lines: [await L("RM-PP-012", "RESIN", 95), await L("RG-PP-001", "REGRIND", 5), await Q("PK-BOX-4030", "PACKAGING", 0.001)] },
    { fg: "FG-HS40", mould: "MD-201", w: 310, lines: [await L("RM-POM-C", "RESIN", 98), await L("MB-BLK-40", "MASTERBATCH", 2), await Q("BOP-INS-M4K", "BOP", 4)] },
  ];
  for (const b of boms) await saveBom({ fgItemId: await item(b.fg), mouldId: await mould(b.mould), partWeightG: b.w, lines: b.lines });
  const bomId = async (fg: string) => (await prisma.bom.findUniqueOrThrow({ where: { fgItemId: await item(fg) } })).id;

  // ── Production runs (create the finished-goods stock) ──
  const lots = (...pairs: [string, number][]) => pairs.map(([heat, qty]) => ({ lotNumber: lotNo.get(heat)!, qty }));
  const runs = [
    { fg: "FG-DT220", m: "M-07", shift: "B" as const, shots: 3800, good: 14600, rej: 300, bin: "D-01-01", lots: lots(["H110-7731", 90], ["BK4021-L77", 3]) },
    { fg: "FG-HX14", m: "M-03", shift: "A" as const, shots: 1100, good: 2100, rej: 60, bin: "D-01-02", lots: lots(["AB2231", 60], ["GR7035-12", 2]) },
    { fg: "FG-BZ31", m: "M-05", shift: "B" as const, shots: 2900, good: 5500, rej: 120, bin: "D-01-03", lots: lots(["PG-118", 110], ["BK4021-L77", 4]) },
    { fg: "FG-CP08", m: "M-01", shift: "C" as const, shots: 1150, good: 9000, rej: 100, bin: "D-02-01", lots: lots(["H110-7731", 35]) },
  ];
  for (const r of runs) {
    await bookProduction({
      bomId: await bomId(r.fg), machineId: await machineId(r.m), shift: r.shift, shots: r.shots, goodParts: r.good, rejectParts: r.rej,
      fgLocationCode: r.bin, regrindLocationCode: "A-02-01", materialLots: r.lots, requireMaterialLots: true, userId: prod,
    });
  }

  // ── Pack and dispatch: one load still being scanned (31 of 40 boxes), one already shipped ──
  const customer = async (code: string) => (await prisma.customer.findUniqueOrThrow({ where: { code } })).id;
  const fgLot = async (fg: string) => (await prisma.lot.findFirstOrThrow({ where: { item: { code: fg } } })).lotNumber;
  const dt = await packBoxes({ lotNumber: await fgLot("FG-DT220"), binCode: "D-01-01", customerId: await customer("CUS-001"), qtyPerBox: 250, boxCount: 40, userId: prod });
  const loading = await createDispatch({ customerId: await customer("CUS-001"), vehicleNumber: "[VEHICLE NO.]", driverName: "[DRIVER]", lines: [{ itemId: await item("FG-DT220"), qty: 10000 }], userId: disp });
  for (const b of dt.slice(0, 31)) await scanBox({ dispatchId: loading.id, scan: b.boxCode });

  const bz = await packBoxes({ lotNumber: await fgLot("FG-BZ31"), binCode: "D-01-03", customerId: await customer("CUS-022"), qtyPerBox: 100, boxCount: 40, userId: prod });
  const shipped = await createDispatch({ customerId: await customer("CUS-022"), vehicleNumber: "[VEHICLE NO.]", lines: [{ itemId: await item("FG-BZ31"), qty: 4000 }], userId: disp });
  for (const b of bz) await scanBox({ dispatchId: shipped.id, scan: b.boxCode });
  await completeDispatch({ dispatchId: shipped.id, crates: [{ itemId: await item("PK-CRATE-RB600"), qty: 40 }], userId: disp });

  // Packed but not yet on a truck, for the HX-14 handle order.
  await packBoxes({ lotNumber: await fgLot("FG-HX14"), binCode: "D-01-02", customerId: await customer("CUS-014"), qtyPerBox: 50, boxCount: 20, userId: prod });

  // ── Returnable crates already at customers (opening balances) ──
  const crate = await item("PK-CRATE-RB600");
  await recordReturnable({ customerId: await customer("CUS-001"), itemId: crate, move: "ISSUED", qty: 1240, note: "Opening balance", userId: disp });
  await recordReturnable({ customerId: await customer("CUS-001"), itemId: crate, move: "RETURNED", qty: 1182, note: "Returned to date", userId: disp });
  await recordReturnable({ customerId: await customer("CUS-022"), itemId: crate, move: "RETURNED", qty: 12, note: "Returned", userId: disp });

  // ── Customer demand ──
  const day = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + n));
  await importDemand({
    fileName: "demo-schedule.csv", replaceForecast: false, rowErrors: [], userId: admin,
    rows: [
      { row: 2, customerCode: "CUS-001", partCode: "FG-DT220", dueDate: day(7), qty: 40000, type: "FIRM" },
      { row: 3, customerCode: "CUS-001", partCode: "FG-DT220", dueDate: day(21), qty: 36000, type: "FORECAST" },
      { row: 4, customerCode: "CUS-014", partCode: "FG-CP08", dueDate: day(10), qty: 25000, type: "FIRM" },
      { row: 5, customerCode: "CUS-014", partCode: "FG-HX14", dueDate: day(14), qty: 12000, type: "FIRM" },
      { row: 6, customerCode: "CUS-022", partCode: "FG-BZ31", dueDate: day(5), qty: 8000, type: "FIRM" },
      { row: 7, customerCode: "CUS-022", partCode: "FG-HS40", dueDate: day(18), qty: 6000, type: "SPOT" },
    ],
  });

  console.log("Demo data loaded: design examples for stock, bins, BOMs, production, dispatch, returnables and demand.");
}

main()
  .catch((e) => { console.error(e instanceof DomainError ? `Rule violation: ${e.message}` : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
