// A complete, date-relative demo of the plant. Everything is dated from today, so the story is always current: customer orders for
// the next 30 days, a few overdue, a few completed and shipped; supplier POs that are on time, late, part-received and closed; lots
// at every stage of QC; stock that is red, yellow and green; production, scrap, final inspection, first-off, counts, returns and a
// machine plan. It goes through the real services, so ledgers, lots, traceability and every screen stay consistent.
//
//   npm run db:seed:demo      adds the demo to a database that has none (does nothing if stock already exists)
//   npm run demo:reset        wipes the plant data and loads it fresh (see prisma/demo-reset.ts; asks for --yes)
//
// Users and roles are never touched. Names are fictional.
import { PrismaClient, type ItemCategory, type Segment } from "@prisma/client";
import {
  createPurchaseOrder, createGrn, recordQc, createMaterialRequest, issueStock, transferStock, DomainError,
} from "../src/server/services/inventory";
import { cancelPurchaseOrder } from "../src/server/services/purchase";
import { saveBom, bookProduction } from "../src/server/services/production";
import { packBoxes } from "../src/server/services/fg";
import { createDispatch, scanBox, completeDispatch, cancelDispatch, recordReturnable } from "../src/server/services/dispatch";
import { importDemand } from "../src/server/services/demand";
import { addGrade, createGroup, decideGrade } from "../src/server/services/equivalents";
import { blockSlot, mondayOf, placeJob } from "../src/server/services/planning";
import { returnMaterial } from "../src/server/services/returns";
import { returnToVendor } from "../src/server/services/rtv";
import { decidePdi } from "../src/server/services/pdi";
import { approveScrap } from "../src/server/services/scrap";
import { requestFirstOff, decideFirstOff } from "../src/server/services/firstoff";
import { startCount, saveCount, submitCount, decideCount } from "../src/server/services/stockcount";

const prisma = new PrismaClient();

// ── "Today" and helpers for dates relative to it ──────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const now = new Date();
const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
/** A calendar day n days from today (negative = past), as the date-only fields of the schema hold them. */
const day = (n: number) => new Date(midnight + n * DAY);
/** A moment n days from today at a given hour (UTC), for created/received/produced timestamps. */
const ts = (n: number, hour = 9) => new Date(midnight + n * DAY + hour * 3_600_000);

// ── Masters ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const SUPPLIERS = [
  { code: "SUP-003", name: "PolyChem India Pvt Ltd", leadTimeDays: 7 }, { code: "SUP-007", name: "Sunrise Polymers", leadTimeDays: 12 },
  { code: "SUP-011", name: "PackRight Corrugates", leadTimeDays: 4 }, { code: "SUP-004", name: "Apex Masterbatches", leadTimeDays: 5 },
  { code: "SUP-015", name: "Meridian Colorants", leadTimeDays: 6 }, { code: "SUP-009", name: "Precision Inserts Ltd", leadTimeDays: 10 },
  { code: "SUP-018", name: "Orbit Engineering Plastics", leadTimeDays: 14 },
];
const CUSTOMERS: { code: string; name: string; segment: Segment; labelFormat: string; gstin: string; address: string }[] = [
  { code: "CUS-001", name: "Maruvi Motors Ltd (Pune Plant)", segment: "AUTOMOTIVE", labelFormat: "OEM", gstin: "27AADCM4001A1Z5", address: "Plot 41, MIDC Chakan, Pune, Maharashtra 410501" },
  { code: "CUS-022", name: "Kesari Auto Components Pvt Ltd", segment: "AUTOMOTIVE", labelFormat: "OEM", gstin: "27AADCK2022C1Z7", address: "Gat 118, Talegaon MIDC, Pune, Maharashtra 410507" },
  { code: "CUS-014", name: "Bharat Home Appliances Ltd", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC", gstin: "27AADCB1014B1Z6", address: "D-22, Ambad Industrial Area, Nashik, Maharashtra 422010" },
  { code: "CUS-031", name: "Zenith Consumer Products", segment: "NON_AUTOMOTIVE", labelFormat: "GENERIC", gstin: "27AADCZ3031D1Z8", address: "B-9, Waluj MIDC, Chhatrapati Sambhajinagar, Maharashtra 431136" },
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
  { code: "RG-PP-001", name: "PP regrind (in-house)", category: "REGRIND", grade: "PP", min: 0, rop: 0, max: 0 },
  { code: "RG-ABS-001", name: "ABS regrind (in-house)", category: "REGRIND", grade: "ABS", min: 0, rop: 0, max: 0 },
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
const PRICES: Record<string, [string, number][]> = {
  "RM-PP-012": [["SUP-003", 112], ["SUP-007", 118]], "RM-ABS-NAT": [["SUP-003", 168], ["SUP-007", 172]], "RM-PA66-G30": [["SUP-003", 310], ["SUP-007", 305]],
  "RM-POM-C": [["SUP-003", 220]], "MB-BLK-40": [["SUP-004", 260], ["SUP-015", 268]], "MB-GRY-7035": [["SUP-015", 255]],
  "BOP-INS-M4K": [["SUP-009", 3.2], ["SUP-018", 3.4]], "BOP-CLIP-SC3": [["SUP-009", 1.8]], "PK-BOX-4030": [["SUP-011", 42]], "PK-FILM-23": [["SUP-011", 380]],
};

// ── Supplier side: every lot, at its own stage ────────────────────────────────────────────────────────────────────────
//   STORED   approved and put away in `bin`           PENDING   in staging, waiting for QC
//   RELEASED approved, still in staging (to put away)  REJECTED  failed QC (returned to the supplier when `returned`)
//   DEVIATED accepted on deviation, put away           COUNT     in staging, QC counted a different quantity (adjustment to approve)
type Stage = "STORED" | "PENDING" | "RELEASED" | "REJECTED" | "DEVIATED" | "COUNT";
interface LotSpec {
  item: string; sup: string; qty: number; heat: string; age: number; stage: Stage; bin?: string; issued?: number; ref?: string;
  remarks?: string; mfi?: number; moisture?: number; counted?: number; returned?: boolean;
  ordered?: number; // ordered more than arrived: the PO stays part-received, with the rest due in a few days
}
const LOTS: LotSpec[] = [
  // PP: red (1,745 against a minimum of 2,000), a PO on the way, one lot in QC and one rejected
  { item: "RM-PP-012", sup: "SUP-003", qty: 900, heat: "H110-7731", age: 20, stage: "STORED", bin: "A-01-01", issued: 120, ref: "MM-PO-88231" },
  { item: "RM-PP-012", sup: "SUP-007", qty: 550, heat: "PH12N-55850", age: 14, stage: "STORED", bin: "A-01-02" },
  { item: "RM-PP-012", sup: "SUP-011", qty: 410, heat: "1200MC-2201", age: 9, stage: "STORED", bin: "A-01-03" },
  { item: "RM-PP-012", sup: "SUP-003", qty: 1000, heat: "H110-7902", age: 1, stage: "PENDING" },
  { item: "RM-PP-012", sup: "SUP-007", qty: 400, heat: "PH12N-55821", age: 6, stage: "REJECTED", remarks: "MFI 18.2 against a 11–13 specification, and the bags were damp", mfi: 18.2, moisture: 0.42 },
  // ABS: green
  { item: "RM-ABS-NAT", sup: "SUP-003", qty: 2000, heat: "AB2231", age: 25, stage: "STORED", bin: "B-01-01", issued: 100 },
  { item: "RM-ABS-NAT", sup: "SUP-007", qty: 1000, heat: "ABS750-118", age: 12, stage: "STORED", bin: "B-01-02" },
  // PA66: yellow, a late PO, and a rejected lot already sent back with a debit note
  { item: "RM-PA66-G30", sup: "SUP-003", qty: 700, heat: "PG-118", age: 22, stage: "STORED", bin: "B-02-01" },
  { item: "RM-PA66-G30", sup: "SUP-007", qty: 450, heat: "A3GF30-77", age: 11, stage: "STORED", bin: "B-02-02" },
  { item: "RM-PA66-G30", sup: "SUP-007", qty: 250, heat: "A3GF30-80", age: 8, stage: "REJECTED", remarks: "Glass content 24% against 30%: fails the tensile test", mfi: 9.4, returned: true },
  // POM: yellow on its own, green with the lot accepted on deviation
  { item: "RM-POM-C", sup: "SUP-003", qty: 650, heat: "POMC27-9", age: 18, stage: "STORED", bin: "B-02-03" },
  { item: "RM-POM-C", sup: "SUP-003", qty: 150, heat: "POMC27-12", age: 4, stage: "DEVIATED", bin: "A-02-03", remarks: "Moisture 0.21% against 0.20%: dry for 4 h before use" , moisture: 0.21 },
  // Masterbatch
  { item: "MB-BLK-40", sup: "SUP-004", qty: 300, heat: "BK4021-L77", age: 21, stage: "STORED", bin: "C-01-01", issued: 40 },
  { item: "MB-BLK-40", sup: "SUP-015", qty: 50, heat: "CB40-12", age: 10, stage: "STORED", bin: "C-01-02" },
  { item: "MB-BLK-40", sup: "SUP-004", qty: 50, heat: "BK4021-L90", age: 1, stage: "COUNT", counted: 48 },
  { item: "MB-GRY-7035", sup: "SUP-015", qty: 95, heat: "GR7035-12", age: 15, stage: "STORED", bin: "C-01-03", ordered: 200 },
  // Inserts (red) and clips (yellow, with a lot in QC)
  { item: "BOP-INS-M4K", sup: "SUP-009", qty: 12000, heat: "INSM4K-B14", age: 17, stage: "STORED", bin: "C-02-01" },
  { item: "BOP-CLIP-SC3", sup: "SUP-009", qty: 14000, heat: "SC3-2210", age: 13, stage: "STORED", bin: "C-02-02" },
  { item: "BOP-CLIP-SC3", sup: "SUP-009", qty: 6000, heat: "SC3-2250", age: 1, stage: "PENDING" },
  // Packaging: boxes yellow with a new lot released and waiting to be put away, film red
  { item: "PK-BOX-4030", sup: "SUP-011", qty: 420, heat: "BX-0418", age: 16, stage: "STORED", bin: "C-02-03" },
  { item: "PK-BOX-4030", sup: "SUP-011", qty: 300, heat: "BX-0425", age: 1, stage: "RELEASED" },
  { item: "PK-FILM-23", sup: "SUP-011", qty: 8, heat: "FILM-23-6", age: 19, stage: "STORED", bin: "C-02-03" },
];

// ── Customer orders: next 30 days, a few overdue, a few completed ─────────────────────────────────────────────────────
// Completed lines are closed by the dispatches below (a completed dispatch fulfils the oldest open order for that customer and part).
const ORDERS: [string, string, number, number, "FIRM" | "SPOT" | "FORECAST"][] = [
  // customer, part, due (days from today), qty, type
  // completed and shipped
  ["CUS-001", "FG-DT220", -12, 14000, "FIRM"], ["CUS-022", "FG-BZ31", -9, 4000, "FIRM"], ["CUS-014", "FG-CP08", -6, 9000, "FIRM"], ["CUS-031", "FG-HX14", -4, 2000, "SPOT"],
  // overdue: one part-shipped, three not shipped (one waiting on QA release, one with boxes packed)
  ["CUS-001", "FG-DT220", -3, 30000, "FIRM"], ["CUS-014", "FG-HX14", -5, 6000, "FIRM"], ["CUS-022", "FG-HS40", -2, 1500, "SPOT"], ["CUS-031", "FG-CP08", -1, 4000, "FIRM"],
  // the next 30 days
  ["CUS-001", "FG-DT220", 2, 24000, "FIRM"], ["CUS-022", "FG-BZ31", 3, 8000, "FIRM"], ["CUS-014", "FG-HX14", 5, 12000, "FIRM"], ["CUS-031", "FG-CP08", 7, 25000, "SPOT"],
  ["CUS-001", "FG-DT220", 10, 40000, "FIRM"], ["CUS-022", "FG-HS40", 12, 3000, "FIRM"], ["CUS-014", "FG-CP08", 14, 30000, "FIRM"], ["CUS-022", "FG-BZ31", 17, 10000, "FIRM"],
  ["CUS-001", "FG-DT220", 21, 36000, "FIRM"], ["CUS-031", "FG-HX14", 24, 8000, "SPOT"], ["CUS-022", "FG-HS40", 28, 2500, "FIRM"], ["CUS-014", "FG-HX14", 30, 15000, "FIRM"],
  // forecast (not orders yet)
  ["CUS-014", "FG-HX14", 20, 10000, "FORECAST"], ["CUS-001", "FG-DT220", 35, 60000, "FORECAST"], ["CUS-022", "FG-BZ31", 45, 20000, "FORECAST"], ["CUS-014", "FG-CP08", 60, 50000, "FORECAST"],
];

async function ensureUsers() {
  const { SYSTEM_ROLES } = await import("../src/server/auth/permissions");
  const bcrypt = (await import("bcryptjs")).default;
  for (const { key, ...r } of SYSTEM_ROLES) await prisma.accessRole.upsert({ where: { key }, update: {}, create: { key, ...r, system: true } });
  const passwordHash = await bcrypt.hash("password123", 10);
  for (const u of [
    { email: "demo@ims.local", name: "Demo User", role: "DEMO" }, { email: "admin@ims.local", name: "Admin", role: "ADMIN" },
    { email: "store@ims.local", name: "Store Incharge", role: "STORE_INCHARGE" }, { email: "qa@ims.local", name: "QA Inspector", role: "QA_INSPECTOR" },
    { email: "production@ims.local", name: "Production Lead", role: "PRODUCTION_LEAD" }, { email: "dispatch@ims.local", name: "Dispatch Officer", role: "DISPATCH_OFFICER" },
    { email: "planner@ims.local", name: "Planner", role: "PLANNER" },
  ]) await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash } });
}

async function loadMasters() {
  await prisma.warehouse.upsert({ where: { code: "WH-MAIN" }, update: {}, create: { code: "WH-MAIN", name: "Main Store" } });
  const wh = await prisma.warehouse.findFirstOrThrow();
  await prisma.location.upsert({ where: { code: "STG-01" }, update: {}, create: { code: "STG-01", rack: "STG", shelf: "01", bin: "01", type: "STAGING", warehouseId: wh.id } });
  for (const [rack, shelves] of [["A", ["01", "02"]], ["B", ["01", "02"]], ["C", ["01", "02"]], ["D", ["01", "02"]], ["E", ["02"]]] as const) {
    for (const shelf of shelves) for (const bin of ["01", "02", "03"]) {
      const code = `${rack}-${shelf}-${bin}`;
      await prisma.location.upsert({ where: { code }, update: {}, create: { code, rack, shelf, bin, type: "STORAGE", warehouseId: wh.id } });
    }
  }
  for (const s of SUPPLIERS) await prisma.supplier.upsert({ where: { code: s.code }, update: {}, create: s });
  for (const c of CUSTOMERS) await prisma.customer.upsert({ where: { code: c.code }, update: {}, create: c });
  for (const [code, tonnage] of MACHINES) await prisma.machine.upsert({ where: { code }, update: {}, create: { code, name: `Injection Machine ${tonnage}T`, tonnage } });
  for (const [code, name, cavities, partG, runG, m] of MOULDS) {
    const machine = await prisma.machine.findUniqueOrThrow({ where: { code: m } });
    await prisma.mould.upsert({ where: { code }, update: {}, create: { code, name, cavities, shotWeightG: partG * cavities, runnerWeightG: runG, machineId: machine.id } });
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
  for (const [code, prices] of Object.entries(PRICES)) {
    const item = await prisma.item.findUniqueOrThrow({ where: { code } });
    for (const [s, price] of prices) {
      const supplier = await prisma.supplier.findUniqueOrThrow({ where: { code: s } });
      await prisma.priceMaster.upsert({ where: { itemId_supplierId: { itemId: item.id, supplierId: supplier.id } }, update: {}, create: { itemId: item.id, supplierId: supplier.id, price } });
    }
  }
}

async function loadDemo() {
  const who = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const [admin, store, qa, prod, disp] = await Promise.all([who("admin@ims.local"), who("store@ims.local"), who("qa@ims.local"), who("production@ims.local"), who("dispatch@ims.local")]);
  const item = async (code: string) => (await prisma.item.findUniqueOrThrow({ where: { code } })).id;
  const sup = async (code: string) => (await prisma.supplier.findUniqueOrThrow({ where: { code } })).id;
  const cust = async (code: string) => (await prisma.customer.findUniqueOrThrow({ where: { code } })).id;
  const machineId = async (code: string) => (await prisma.machine.findUniqueOrThrow({ where: { code } })).id;
  const spec = (code: string) => ITEMS.find((i) => i.code === code)!;

  // ── Receive every lot at its own stage, dated by its age ──
  const lotNo = new Map<string, string>(); // supplier heat/lot -> internal lot number
  const lotId = new Map<string, string>();
  for (const l of LOTS) {
    const po = await createPurchaseOrder({
      supplierId: await sup(l.sup), segment: spec(l.item).coa ? "AUTOMOTIVE" : "NON_AUTOMOTIVE", userId: store, externalRef: l.ref,
      lines: [{ itemId: await item(l.item), qty: l.ordered ?? l.qty, expectedDate: l.ordered ? day(3) : day(-l.age) }],
    });
    const grn = await createGrn({
      poId: po.id, vehicleNumber: `MH12${["AB", "CD", "EF", "GH"][l.age % 4]}${1000 + ((l.age * 37) % 8999)}`, invoiceNumber: `INV/${l.heat}`, userId: store,
      coaUrl: spec(l.item).coa ? `COA-${l.heat}` : undefined,
      lines: [{ poLineId: po.lines[0].id, qty: l.qty, supplierLotNo: l.heat, bags: l.item.startsWith("RM-") ? Math.round(l.qty / 25) : undefined }],
    });
    const lot = await prisma.lot.findFirstOrThrow({ where: { grnLine: { grnId: grn.id } } });
    lotNo.set(l.heat, lot.lotNumber); lotId.set(l.heat, lot.id);

    const common = { lotId: lot.id, userId: qa };
    if (l.stage === "STORED") await recordQc({ ...common, decision: "APPROVED", mfi: l.mfi ?? 12.2, moisturePct: l.moisture ?? 0.03, density: 0.905, countedQty: l.qty, putawayLocationCode: l.bin });
    if (l.stage === "RELEASED") await recordQc({ ...common, decision: "APPROVED", mfi: 12.0, moisturePct: 0.03, countedQty: l.qty });
    if (l.stage === "DEVIATED") await recordQc({ ...common, decision: "DEVIATED", remarks: l.remarks, moisturePct: l.moisture, countedQty: l.qty, putawayLocationCode: l.bin });
    if (l.stage === "REJECTED") await recordQc({ ...common, decision: "REJECTED", remarks: l.remarks, mfi: l.mfi, moisturePct: l.moisture, countedQty: l.qty });
    if (l.stage === "COUNT") await recordQc({ ...common, decision: "APPROVED", mfi: 12.0, countedQty: l.counted }); // a difference: goes for approval, stays in staging

    // Date the receipt and everything that followed it
    const received = ts(-l.age, 10);
    await prisma.lot.update({ where: { id: lot.id }, data: { receivedAt: received } });
    await prisma.stockTransaction.updateMany({ where: { lotId: lot.id }, data: { createdAt: received } });
    await prisma.qcInspection.updateMany({ where: { lotId: lot.id }, data: { inspectedAt: new Date(received.getTime() + 4 * 3_600_000) } });
    await prisma.grn.update({ where: { id: grn.id }, data: { createdAt: received } });
    await prisma.gateEntry.updateMany({ where: { poId: po.id }, data: { arrivedAt: received } });
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { createdAt: new Date(received.getTime() - 6 * DAY) } });
  }

  // A rejected lot already sent back, with its debit note
  const returned = LOTS.find((l) => l.returned)!;
  const rtv = await returnToVendor({ lotNumber: lotNo.get(returned.heat)!, qty: returned.qty, reason: `${returned.remarks}. Returned to the supplier with the COA and test report.`, userId: store });
  await prisma.returnToVendor.update({ where: { id: rtv.id }, data: { createdAt: ts(-5, 11) } });
  await prisma.stockTransaction.updateMany({ where: { refType: "RTV", refId: rtv.id }, data: { createdAt: ts(-5, 11) } });

  // ── Supplier POs still open: on time, late, and one cancelled (the grey masterbatch PO above is part-received: 95 of 200) ──
  const onOrder = async (s: string, i: string, qty: number, due: number, ageDays: number, seg: Segment = "NON_AUTOMOTIVE") => {
    const po = await createPurchaseOrder({ supplierId: await sup(s), segment: seg, userId: store, lines: [{ itemId: await item(i), qty, expectedDate: day(due) }] });
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { createdAt: ts(-ageDays, 11) } });
    return po;
  };
  await onOrder("SUP-003", "RM-PP-012", 3000, 3, 5, "AUTOMOTIVE");      // on its way for the red resin
  await onOrder("SUP-009", "BOP-INS-M4K", 80000, 4, 8);                   // on its way for the red inserts
  await onOrder("SUP-007", "RM-PA66-G30", 1000, -3, 15, "AUTOMOTIVE");   // late
  await onOrder("SUP-011", "PK-FILM-23", 10, -4, 9);                      // late
  const cancelled = await onOrder("SUP-018", "BOP-INS-M4K", 40000, 9, 12);
  await cancelPurchaseOrder(cancelled.id);

  // ── Stock issued to the floor, requisitions waiting, and leftover material returned ──
  const issueTo = async (m: string, code: string, heat: string, bin: string, qty: number) => {
    const req = await createMaterialRequest({ machineId: await machineId(m), lines: [{ itemId: await item(code), qty }], userId: prod });
    const line = await prisma.materialRequestLine.findFirstOrThrow({ where: { requestId: req.id } });
    await issueStock({ requestLineId: line.id, lotNumber: lotNo.get(heat)!, locationCode: bin, qty, userId: store });
    await prisma.materialRequest.update({ where: { id: req.id }, data: { createdAt: ts(-3, 8) } });
  };
  for (const l of LOTS.filter((x) => x.issued)) await issueTo("M-07", l.item, l.heat, l.bin!, l.issued!);
  await returnMaterial({ lotNumber: lotNo.get("H110-7731")!, locationCode: "A-01-01", qty: 15, note: "Leftover at end of shift", userId: prod });
  for (const [m, code, qty] of [["M-07", "RM-PP-012", 42], ["M-03", "MB-GRY-7035", 2], ["M-05", "BOP-INS-M4K", 2000], ["M-09", "RM-POM-C", 60]] as const) {
    await createMaterialRequest({ machineId: await machineId(m), lines: [{ itemId: await item(code), qty }], userId: prod });
  }

  // ── BOMs ──
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

  // ── Customer orders (before the dispatches that complete some of them) ──
  const rows = ORDERS.map(([c, p, due, qty, type], i) => ({ row: i + 2, customerCode: c, partCode: p, dueDate: day(due), qty, type }));
  await importDemand({ fileName: "customer-schedule.csv", rows, rowErrors: [], replaceForecast: false, userId: admin });

  // ── Production runs create the finished goods ──
  const lots = (...pairs: [string, number][]) => pairs.map(([heat, qty]) => ({ lotNumber: lotNo.get(heat)!, qty }));
  interface Run { key: string; fg: string; m: string; shift: "A" | "B" | "C"; shots: number; good: number; rej: number; bin: string; age: number; lots: { lotNumber: string; qty: number }[] }
  const runs: Run[] = [
    { key: "dt1", fg: "FG-DT220", m: "M-07", shift: "B", shots: 3800, good: 14600, rej: 300, bin: "D-01-01", age: 14, lots: lots(["H110-7731", 90], ["BK4021-L77", 3]) },
    { key: "dt2", fg: "FG-DT220", m: "M-07", shift: "A", shots: 3900, good: 15000, rej: 280, bin: "D-01-01", age: 7, lots: lots(["H110-7731", 90], ["BK4021-L77", 3]) },
    { key: "dt3", fg: "FG-DT220", m: "M-11", shift: "B", shots: 3800, good: 14800, rej: 260, bin: "D-02-02", age: 1, lots: lots(["PH12N-55850", 90], ["BK4021-L77", 3]) },
    { key: "bz1", fg: "FG-BZ31", m: "M-05", shift: "B", shots: 2900, good: 5500, rej: 120, bin: "D-01-03", age: 12, lots: lots(["PG-118", 110], ["BK4021-L77", 4]) },
    { key: "cp1", fg: "FG-CP08", m: "M-01", shift: "C", shots: 1150, good: 9000, rej: 100, bin: "D-02-01", age: 10, lots: lots(["H110-7731", 35]) },
    { key: "cp2", fg: "FG-CP08", m: "M-01", shift: "A", shots: 1150, good: 9000, rej: 90, bin: "D-02-01", age: 4, lots: lots(["PH12N-55850", 35]) },
    { key: "hx1", fg: "FG-HX14", m: "M-03", shift: "A", shots: 1100, good: 2100, rej: 60, bin: "D-01-02", age: 11, lots: lots(["AB2231", 60], ["GR7035-12", 2]) },
    { key: "hx2", fg: "FG-HX14", m: "M-03", shift: "B", shots: 1600, good: 3100, rej: 60, bin: "D-01-02", age: 3, lots: lots(["ABS750-118", 90], ["GR7035-12", 2]) },
    { key: "bz2", fg: "FG-BZ31", m: "M-05", shift: "A", shots: 1000, good: 1900, rej: 40, bin: "D-01-03", age: 0, lots: lots(["A3GF30-77", 45], ["BK4021-L77", 2]) },
    { key: "hs1", fg: "FG-HS40", m: "M-09", shift: "A", shots: 1800, good: 1750, rej: 30, bin: "E-02-01", age: 2, lots: lots(["POMC27-9", 560], ["BK4021-L77", 12]) },
  ];
  const fgLotOf = new Map<string, string>(); // run key -> lot number
  const bookingOf = new Map<string, string>();
  for (const r of runs) {
    const res = await bookProduction({
      bomId: await bomId(r.fg), machineId: await machineId(r.m), shift: r.shift, shots: r.shots, goodParts: r.good, rejectParts: r.rej,
      fgLocationCode: r.bin, regrindLocationCode: "A-02-01", materialLots: r.lots, requireMaterialLots: true, userId: prod,
    });
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: res.fgLotId! } });
    fgLotOf.set(r.key, lot.lotNumber); bookingOf.set(r.key, res.booking.id);
    const when = ts(-r.age, r.shift === "A" ? 12 : r.shift === "B" ? 20 : 4);
    await prisma.productionBooking.update({ where: { id: res.booking.id }, data: { producedAt: when } });
    await prisma.lot.update({ where: { id: lot.id }, data: { receivedAt: when } });
    await prisma.stockTransaction.updateMany({ where: { lotId: lot.id }, data: { createdAt: when } });
  }

  // QA scrap decisions: the older runs are settled (regrind where allowed), the two newest are waiting
  // (parts with inserts or clips can only be scrapped as waste; the handle and the cap can be reground)
  for (const [key, kind] of [["dt1", "WASTE"], ["bz1", "WASTE"], ["cp1", "REGRIND"], ["hx1", "REGRIND"], ["dt2", "WASTE"], ["cp2", "WASTE"]] as const) {
    const b = await prisma.productionBooking.findUniqueOrThrow({ where: { id: bookingOf.get(key)! } });
    await approveScrap({ bookingId: b.id, parts: b.rejectParts, kind, regrindLocationCode: "A-02-01", note: kind === "WASTE" ? "Short shots, flash and insert pull-out failures" : undefined, userId: qa });
  }
  await prisma.scrapDisposition.updateMany({ where: {}, data: { createdAt: ts(-2, 15) } });

  // Final inspection: most lots are released, two are waiting and one is on hold
  for (const key of ["dt1", "dt2", "dt3", "bz1", "cp1", "hx1"]) await decidePdi({ lotNumber: fgLotOf.get(key)!, release: true, userId: qa });
  await decidePdi({ lotNumber: fgLotOf.get("cp2")!, release: true, userId: qa });
  await decidePdi({ lotNumber: fgLotOf.get("hx2")!, release: false, remarks: "Sink marks on the grip of 6 of 32 samples: re-check after the mould is polished", userId: qa });
  // bz2 and hs1 stay in the queue

  // ── Pack and ship ──
  const pack = (key: string, bin: string, customer: string, perBox: number, boxes: number) =>
    packBoxes({ lotNumber: fgLotOf.get(key)!, binCode: bin, customerId: customerIds.get(customer)!, qtyPerBox: perBox, boxCount: boxes, userId: prod });
  const customerIds = new Map<string, string>();
  for (const c of CUSTOMERS) customerIds.set(c.code, await cust(c.code));
  const crate = await item("PK-CRATE-RB600");
  const ship = async (customer: string, fg: string, boxes: { boxCode: string }[], qty: number, agoDays: number, crates: number) => {
    const d = await createDispatch({ customerId: customerIds.get(customer)!, lines: [{ itemId: await item(fg), qty }], userId: disp });
    for (const b of boxes) await scanBox({ dispatchId: d.id, scan: b.boxCode });
    const done = await completeDispatch({ dispatchId: d.id, crates: crates ? [{ itemId: crate, qty: crates }] : [], userId: disp });
    const when = ts(-agoDays, 14);
    await prisma.dispatch.update({ where: { id: d.id }, data: { createdAt: new Date(when.getTime() - 3 * 3_600_000), dispatchedAt: when, vehicleNumber: `MH14${agoDays}${1200 + agoDays * 31}`, driverName: ["R. Patil", "S. Shaikh", "M. Jadhav"][agoDays % 3] } });
    await prisma.stockTransaction.updateMany({ where: { refType: "DISPATCH", refId: done.dcNumber }, data: { createdAt: when } });
    await prisma.returnableLedger.updateMany({ where: { dispatchId: d.id }, data: { createdAt: when } });
  };
  // Completed orders (each closes the oldest open order of that customer and part)
  await ship("CUS-001", "FG-DT220", await pack("dt1", "D-01-01", "CUS-001", 250, 56), 14000, 13, 56);
  await ship("CUS-022", "FG-BZ31", await pack("bz1", "D-01-03", "CUS-022", 100, 40), 4000, 10, 40);
  await ship("CUS-014", "FG-CP08", await pack("cp1", "D-02-01", "CUS-014", 500, 18), 9000, 7, 0);
  await ship("CUS-031", "FG-HX14", await pack("hx1", "D-01-02", "CUS-031", 50, 40), 2000, 5, 0);
  // Part of the overdue Maruvi order: 15,000 shipped, then another 10,000 being loaded now (31 of 40 boxes scanned)
  await ship("CUS-001", "FG-DT220", await pack("dt2", "D-01-01", "CUS-001", 250, 60), 15000, 4, 60);
  const loadingBoxes = await pack("dt3", "D-02-02", "CUS-001", 250, 40);
  const loading = await createDispatch({ customerId: customerIds.get("CUS-001")!, lines: [{ itemId: await item("FG-DT220"), qty: 10000 }], userId: disp });
  for (const b of loadingBoxes.slice(0, 31)) await scanBox({ dispatchId: loading.id, scan: b.boxCode });
  // Packed and ready for the overdue Bharat order, and a pick list that was cancelled
  await pack("hx2", "D-01-02", "CUS-014", 50, 20);
  const cancelledDc = await createDispatch({ customerId: customerIds.get("CUS-031")!, lines: [{ itemId: await item("FG-CP08"), qty: 2000 }], userId: disp });
  await cancelDispatch(cancelledDc.id);
  await prisma.dispatch.update({ where: { id: cancelledDc.id }, data: { createdAt: ts(-2, 10) } });

  // ── Returnable crates already at customers ──
  await recordReturnable({ customerId: customerIds.get("CUS-001")!, itemId: crate, move: "ISSUED", qty: 1240, note: "Opening balance", userId: disp });
  await recordReturnable({ customerId: customerIds.get("CUS-001")!, itemId: crate, move: "RETURNED", qty: 1182, note: "Returned to date", userId: disp });
  await recordReturnable({ customerId: customerIds.get("CUS-022")!, itemId: crate, move: "RETURNED", qty: 12, note: "Returned", userId: disp });

  // ── First-off: two decided, one waiting for QA ──
  const fo = async (m: string, fg: string, shift: "A" | "B" | "C", approve: boolean | null, note: string, agoDays: number) => {
    const r = await requestFirstOff({ machineId: await machineId(m), bomId: await bomId(fg), shift, note, userId: prod });
    if (approve !== null) await decideFirstOff({ id: r.id, approve, note: approve ? "First parts within tolerance" : "Flash on the parting line: re-polish and ask again", userId: qa });
    await prisma.firstOff.update({ where: { id: r.id }, data: { createdAt: ts(-agoDays, 7) } });
  };
  await fo("M-07", "FG-DT220", "A", true, "Mould back after PM", 7);
  await fo("M-05", "FG-BZ31", "B", false, "New insert supplier", 3);
  await fo("M-09", "FG-HS40", "A", null, "New mould MD-201 set-up", 0);

  // ── Stock counts: one finished, one counted and waiting for approval, one being counted ──
  const count = async (bin: string, diffs: Record<string, number | null>, fin: "approve" | "submit" | "open", agoDays: number) => {
    const c = await startCount({ locationCode: bin, userId: store });
    const sheet = await prisma.stockCountLine.findMany({ where: { countId: c.id }, include: { lot: true } });
    if (fin !== "open") {
      await saveCount(c.id, sheet.map((l) => ({ lotNumber: l.lot.lotNumber, countedQty: diffs[l.lot.supplierLotNo] ?? Number(l.systemQty) })), store);
      await submitCount(c.id, store);
      if (fin === "approve") await decideCount({ id: c.id, approve: true, note: "Recount agreed; bag weights re-checked", userId: admin });
    }
    await prisma.stockCount.update({ where: { id: c.id }, data: { createdAt: ts(-agoDays, 9), ...(fin === "approve" ? { decidedAt: ts(-agoDays, 14) } : {}) } });
  };
  await count("C-01-02", { "CB40-12": 48 }, "approve", 6);   // history: adjusted by -2
  await count("A-01-03", { "1200MC-2201": 396 }, "submit", 0); // waiting for the Admin
  await count("B-01-01", {}, "open", 0);                       // sheet open, not counted yet

  // ── A put-away already done by Store (history in the ledger) ──
  await transferStock({ lotNumber: lotNo.get("BX-0418")!, fromCode: "C-02-03", toCode: "D-02-03", qty: 20, userId: store });

  console.log("Core demo loaded: customer orders, POs, lots at every QC stage, production, dispatch, counts, first-off and returns.");
}

// Equivalent groups, maintenance history, downtime and a planned fortnight: the data behind Equivalents, Maintenance, Planning and Metrics.
async function loadPlanning() {
  const item = async (code: string) => (await prisma.item.findUniqueOrThrow({ where: { code } })).id;
  const sup = async (code: string) => (await prisma.supplier.findUniqueOrThrow({ where: { code } })).id;
  const admin = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@ims.local" } })).id;
  const qa = (await prisma.user.findUniqueOrThrow({ where: { email: "qa@ims.local" } })).id;
  const lead = (await prisma.user.findUniqueOrThrow({ where: { email: "production@ims.local" } })).id;

  type Appr = "ALL" | "NON_AUTO" | "PENDING";
  const groups: [string, string, string, [string, string, Appr][]][] = [
    ["RM-PP-012", "PP Homopolymer MFI 12", "MFI 11–13 g/10min, ρ 0.900–0.910, H₂O ≤ 0.05%", [["Grade H110", "SUP-003", "ALL"], ["Grade PH-12N", "SUP-007", "ALL"], ["Grade 1200MC", "SUP-011", "NON_AUTO"]]],
    ["RM-ABS-NAT", "ABS natural", "MFI 18–24 g/10min, Izod ≥ 20 kJ/m², H₂O ≤ 0.1%", [["AB-NT-20", "SUP-003", "ALL"], ["ABS-750", "SUP-007", "ALL"]]],
    ["RM-PA66-G30", "PA66 GF30", "30% glass, Tensile ≥ 170 MPa, dry to ≤ 0.2%", [["PA-G30", "SUP-003", "ALL"], ["A3-GF30", "SUP-007", "ALL"]]],
    ["RM-POM-C", "POM copolymer", "MFI 8–10 g/10min, ρ 1.41, H₂O ≤ 0.2%", [["POM-C27", "SUP-003", "PENDING"]]],
    ["MB-BLK-40", "Black masterbatch 40%", "Carbon 40%, carrier PP, ΔE ≤ 1.0 vs master", [["BK-4021", "SUP-004", "ALL"], ["CB-40", "SUP-015", "ALL"]]],
    ["BOP-INS-M4K", "Brass insert M4 knurled", "M4 × 6 mm, CuZn39Pb3, pull-out ≥ 900 N", [["INS-M4-K", "SUP-009", "ALL"], ["M4-BR-06", "SUP-018", "PENDING"]]],
  ];
  for (const [code, name, spec, grades] of groups) {
    const g = await createGroup({ name, itemId: await item(code), spec });
    for (const [grade, s, appr] of grades) {
      const gr = await addGrade({ groupId: g.id, gradeName: grade, supplierId: await sup(s), datasheetRef: "demo-datasheet", trialRef: appr === "ALL" ? "demo-trial" : undefined, userId: lead });
      if (appr !== "PENDING") await decideGrade({ gradeId: gr.id, decision: appr === "ALL" ? "APPROVE_ALL" : "APPROVE_NON_AUTO", userId: qa });
    }
  }

  // Mould settings: cycle time (OEE performance), smallest press, and where each mould is in its PM cycle
  const mouldSetup: [string, number, number, number, number][] = [ // code, cycle s, min tonnage, shot counter now, shots left to next PM
    ["MD-118", 20, 150, 412880, 37120], ["MD-090", 28, 120, 188400, 11600], ["MD-131", 32, 150, 351200, -1200],
    ["MD-052", 12, 80, 92000, 8000], ["MD-201", 45, 250, 24500, 25500],
  ];

  // 45 days of production and stops behind Metrics (all but the newest are settled scrap decisions)
  const bomOf = async (fg: string) => prisma.bom.findUniqueOrThrow({ where: { fgItemId: await item(fg) }, include: { mould: true } });
  const runs: [string, string][] = [["M-07", "FG-DT220"], ["M-03", "FG-HX14"], ["M-05", "FG-BZ31"], ["M-01", "FG-CP08"], ["M-09", "FG-HS40"], ["M-11", "FG-DT220"]];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const reasons = ["MOULD_CHANGE", "MOULD_CHANGE", "COLOUR_CHANGE", "MOULD_REPAIR", "NO_MATERIAL", "MACHINE_BREAKDOWN", "QC_HOLD", "NO_OPERATOR", "POWER_CUT"] as const;
  let n = 0;
  const history: { id: string; rej: number; part: number }[] = [];
  for (let back = 45; back >= 1; back--) {
    const d = ts(-back, 12);
    if (d.getUTCDay() === 0) continue;
    for (const [mc, fg] of runs) {
      const m = await prisma.machine.findUniqueOrThrow({ where: { code: mc } });
      const bom = await bomOf(fg);
      const cycle = Number(mouldSetup.find((x) => x[0] === bom.mould.code)![1]);
      for (const shift of ["A", "B", ...(rnd() < 0.35 ? ["C"] : [])] as ("A" | "B" | "C")[]) {
        const stop = rnd() < 0.55 ? Math.round(15 + rnd() * 90) : 0;
        const wasted = rnd() < 0.1 ? Math.round(30 + rnd() * 120) : 0;
        const runMin = 480 - stop - wasted;
        const shots = Math.max(0, Math.round((runMin * 60 * (0.72 + rnd() * 0.2)) / cycle));
        const parts = shots * bom.mould.cavities;
        const rej = Math.round(parts * (0.01 + rnd() * 0.035));
        const b = await prisma.productionBooking.create({
          data: { bookingNumber: `PB-H-${String(++n).padStart(5, "0")}`, bomId: bom.id, machineId: m.id, shift, shots, goodParts: parts - rej, rejectParts: rej,
            runnerKg: (shots * Number(bom.mould.runnerWeightG ?? 0)) / 1000, producedAt: new Date(d.getTime() + (shift === "A" ? -6 : shift === "B" ? 2 : 10) * 3_600_000), userId: lead },
        });
        history.push({ id: b.id, rej, part: Number(bom.partWeightG) });
        const dayOnly = new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z");
        if (stop) await prisma.downtime.create({ data: { machineId: m.id, mouldId: bom.mouldId, day: dayOnly, shift, reason: reasons[Math.floor(rnd() * reasons.length)], minutes: stop, userId: lead } });
        if (wasted) await prisma.downtime.create({ data: { machineId: m.id, mouldId: bom.mouldId, day: dayOnly, shift, reason: rnd() < 0.4 ? "MACHINE_BREAKDOWN" : "MOULD_REPAIR", minutes: wasted, userId: lead } });
      }
    }
  }
  // Their rejects are settled (as waste) so only the real recent runs wait in QA's scrap queue
  await prisma.scrapDisposition.createMany({
    data: history.filter((h) => h.rej > 0).map((h) => ({ bookingId: h.id, parts: h.rej, weightKg: (h.rej * h.part) / 1000, kind: "WASTE" as const, note: "Settled", approvedById: qa, createdAt: ts(-2, 15) })),
  });

  const booked = await prisma.productionBooking.groupBy({ by: ["bomId"], _sum: { shots: true } });
  for (const [code, cycle, tonnage, shotsNow, left] of mouldSetup) {
    const mould = await prisma.mould.findUniqueOrThrow({ where: { code }, include: { boms: true } });
    const shots = booked.filter((b) => mould.boms.some((x) => x.id === b.bomId)).reduce((a, b) => a + (b._sum.shots ?? 0), 0);
    const opening = Math.max(0, shotsNow - shots);
    await prisma.mould.update({ where: { id: mould.id }, data: { idealCycleSec: cycle, minTonnage: tonnage, openingShots: opening, lastPmShots: opening + shots + left - mould.pmIntervalShots } });
  }

  // PM and repair history
  const hist = async (code: string, entries: [number, "PM" | "REPAIR" | "TRIAL", string, number, number?][]) => {
    const mould = await prisma.mould.findUniqueOrThrow({ where: { code } });
    for (const [daysAgo, kind, what, shots, min] of entries) {
      const createdAt = ts(-daysAgo, 10);
      if (kind === "PM") await prisma.pmRecord.create({ data: { mouldId: mould.id, shotsAtPm: shots, checks: "Clean vents and parting line\nCheck ejector pins and return springs\nFlush cooling lines, check leaks\nInspect gate and runner wear\nGrease guide pillars and bushes", photoRef: "demo-photo", note: what, userId: lead, createdAt } });
      else await prisma.repairTicket.create({ data: { mouldId: mould.id, kind, summary: what, downtimeMin: min ?? 0, photoRef: "demo-photo", userId: lead, createdAt } });
    }
  };
  await hist("MD-131", [[41, "PM", "PM at 300,000 shots", 300000], [84, "REPAIR", "Cracked ejector pin #3 replaced", 0, 95]]);
  await hist("MD-052", [[65, "PM", "PM at 50,000 shots", 50000]]);
  await hist("MD-090", [[56, "PM", "PM at 150,000 shots", 150000], [105, "REPAIR", "Hot sprue heater replaced", 0, 140]]);
  await hist("MD-118", [[7, "REPAIR", "Cavity 3 flash: parting line polished", 0, 25], [23, "PM", "PM at 400,000 shots", 400000]]);
  await hist("MD-201", [[50, "TRIAL", "New tool approved (PPAP samples)", 0]]);

  // The machine plan: this week and next, covering the open orders
  const monday = mondayOf(new Date());
  const dayOf = (i: number) => new Date(monday.getTime() + i * DAY).toISOString().slice(0, 10);
  const mid = async (code: string) => (await prisma.machine.findUniqueOrThrow({ where: { code } })).id;
  const plan: [string, number, string][] = [
    ["M-07", 0, "FG-DT220"], ["M-07", 1, "FG-DT220"], ["M-07", 2, "FG-DT220"], ["M-11", 1, "FG-DT220"], ["M-11", 3, "FG-DT220"],
    ["M-03", 0, "FG-HX14"], ["M-03", 1, "FG-HX14"], ["M-03", 2, "FG-HX14"], ["M-05", 3, "FG-BZ31"], ["M-05", 4, "FG-BZ31"],
    ["M-01", 2, "FG-CP08"], ["M-01", 3, "FG-CP08"], ["M-09", 5, "FG-HS40"],
    ["M-07", 7, "FG-DT220"], ["M-07", 8, "FG-DT220"], ["M-03", 7, "FG-HX14"], ["M-03", 8, "FG-HX14"], ["M-05", 9, "FG-BZ31"], ["M-01", 8, "FG-CP08"], ["M-09", 10, "FG-HS40"],
  ];
  for (const [m, d, fg] of plan) {
    const when = new Date(monday.getTime() + d * DAY);
    if (when.getUTCDay() === 0) continue;
    await placeJob({ machineId: await mid(m), day: dayOf(d), fgItemId: await item(fg), userId: admin }).catch((e) => { if (!(e instanceof DomainError)) throw e; });
  }
  await blockSlot({ machineId: await mid("M-09"), day: dayOf(1), kind: "TRIAL", note: "MD-212 trial", userId: admin });
  await blockSlot({ machineId: await mid("M-11"), day: dayOf(2), kind: "PM", note: "Machine PM", userId: admin });
}

export async function loadAllDemo() {
  await ensureUsers();
  if (await prisma.lot.findFirst()) { console.log("Plant data already exists; nothing to do. Use npm run demo:reset to start over."); return; }
  await loadMasters();
  await loadDemo();
  await loadPlanning();
  console.log("Demo ready. Sign in as demo@ims.local (every screen) or <role>@ims.local, password: password123.");
}

if (process.argv[1]?.endsWith("seed-demo.ts")) {
  loadAllDemo()
    .catch((e) => { console.error(e instanceof DomainError ? `Rule violation: ${e.message}` : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
