// Records the plant's material flow through the app, one video per step, each signed in as the role that does it:
// Store receives a truck, QA inspects it, Production asks for material, Store issues it FIFO, Production books and packs,
// QA releases the lot (PDI) and decides the rejects, Dispatch picks, loads and ships.
//
//   npm run record:flows            (needs `npm run dev` running and the demo data from db:seed + db:seed:demo)
//
// It drives the real screens and really posts each step, so run it on demo data only (`npm run demo:reset -- --yes` after).
// The database is only read, to pick a PO, lots and boxes that exist. Videos (.webm, play in Chrome) go to ../recordings.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, type Browser, type Locator, type Page } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.DEMO_PASSWORD ?? "password123"; // the dev-only seed password (prisma/seed.ts)
// DEVICE=phone records the same steps at phone width (touch, 390 × 844) into ../recordings/mobile. On a phone the caption would
// cover the screen, so it is not drawn; it is saved with its timing beside each video for the film (scripts/demo-video.ts).
const PHONE = process.env.DEVICE === "phone";
const OUT = path.resolve(process.cwd(), process.env.RECORD_DIR ?? (PHONE ? "../recordings/mobile" : "../recordings"));
const SIZE = PHONE ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const db = new PrismaClient();
// FROM=7 re-records from step 7 on, using the latest data for the steps before it (e.g. after a run stopped part-way).
const FROM = Number(process.env.FROM ?? 1);
const at = (step: number) => FROM <= step;

const ROLE = {
  store: { email: "store@ims.local", name: "Store Incharge", color: "#1E7A46" },
  qa: { email: "qa@ims.local", name: "QA Inspector", color: "#1D4ED8" },
  production: { email: "production@ims.local", name: "Production Lead", color: "#6B4FB0" },
  dispatch: { email: "dispatch@ims.local", name: "Dispatch Officer", color: "#8A5A12" },
} as const;
type RoleKey = keyof typeof ROLE;

// ───────── On-screen caption, kept across page loads ─────────

const shown = new WeakMap<Page, { role: RoleKey; text: string }>();
const timeline = new WeakMap<Page, { start: number; cues: { t: number; text: string }[] }>();

async function caption(page: Page, role: RoleKey, text: string) {
  const log = timeline.get(page);
  log?.cues.push({ t: (Date.now() - log.start) / 1000, text });
  if (!PHONE) {
    shown.set(page, { role, text });
    await drawCaption(page, role, text);
  }
  await page.waitForTimeout(1600);
}

async function drawCaption(page: Page, role: RoleKey, text: string) {
  const r = ROLE[role];
  await page.evaluate(({ name, color, text }) => {
    let el = document.getElementById("__rec-cap");
    if (!el) {
      el = document.createElement("div");
      el.id = "__rec-cap";
      el.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;max-width:min(1100px,92vw);display:flex;gap:12px;align-items:center;padding:12px 18px;border-radius:14px;background:rgba(17,20,23,.92);color:#fff;font:500 17px/1.35 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none";
      document.body.appendChild(el);
    }
    el.innerHTML = "";
    const chip = document.createElement("span");
    chip.textContent = name;
    chip.style.cssText = `flex:none;padding:4px 10px;border-radius:999px;background:${color};font-weight:700;font-size:14px`;
    const t = document.createElement("span");
    t.textContent = text;
    el.append(chip, t);
  }, { name: r.name, color: r.color, text });
}

// ───────── Helpers ─────────

async function open(page: Page, url: string) {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

/** Clicks a submit button and waits for the app's success redirect (`?ok=`); on a rule error, fails with the message shown. */
async function submit(page: Page, button: Locator, what: string) {
  await button.scrollIntoViewIfNeeded();
  await button.click();
  try {
    await page.waitForURL(/[?&]ok=/, { timeout: 25_000 });
  } catch {
    const shown = (await page.locator("body").innerText()).split("\n").filter((l) => l.trim()).slice(0, 40).join(" | ");
    throw new Error(`${what} did not succeed. Page says: ${shown.slice(0, 600)}`);
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
}

async function typeInto(field: Locator, text: string) {
  await field.click();
  await field.fill("");
  await field.pressSequentially(text, { delay: 35 });
}

async function chapter(browser: Browser, file: string, role: RoleKey, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext(PHONE
    ? { viewport: SIZE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, recordVideo: { dir: OUT, size: SIZE } } // video frames are CSS size
    : { viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  // Keep the Next.js dev badge out of the picture.
  await context.addInitScript(() => {
    const s = document.createElement("style");
    s.textContent = "nextjs-portal{display:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(s));
  });
  const page = await context.newPage();
  timeline.set(page, { start: Date.now(), cues: [] });
  page.on("load", () => {
    // A full page load drops the caption; put the current one back.
    const c = shown.get(page);
    if (c) drawCaption(page, c.role, c.text).catch(() => undefined);
  });
  try {
    await open(page, "/login");
    await caption(page, role, `Signs in with their own account. Each role only sees its own screens.`);
    await typeInto(page.locator('input[name="email"]'), ROLE[role].email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await run(page);
    await page.waitForTimeout(1500);
  } finally {
    const video = page.video();
    await context.close();
    if (video) renameSync(await video.path(), path.join(OUT, `${file}.webm`));
    writeFileSync(path.join(OUT, `${file}.json`), JSON.stringify(timeline.get(page)?.cues ?? []));
  }
  console.log(`✓ ${file}`);
}

// ───────── The story ─────────

async function main() {
  mkdirSync(OUT, { recursive: true });

  // A PO still to receive, with a resin line on it (automotive first, so the COA rule shows).
  const pos = await db.purchaseOrder.findMany({
    where: { status: { in: ["APPROVED", "PARTIAL"] } },
    include: { supplier: true, lines: { include: { item: true } } },
    orderBy: [{ segment: "asc" }, { createdAt: "asc" }],
  });
  const po = pos.find((p) => p.lines.some((l) => l.item.category === "RM_RESIN" && Number(l.qty) > Number(l.receivedQty)));
  if (!po && at(1)) throw new Error("No open supplier PO with a resin line to receive. Run `npm run demo:reset -- --yes` first.");
  const poLine = po?.lines.find((l) => l.item.category === "RM_RESIN" && Number(l.qty) > Number(l.receivedQty));
  const receiveQty = poLine ? Math.min(Number(poLine.qty) - Number(poLine.receivedQty), 500) : 0;
  const heat = `H${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`;

  const browser = await chromium.launch({ slowMo: 90 });
  try {
    // 1 · Store receives the truck
    if (at(1) && po && poLine) await chapter(browser, "01 Store Incharge - receive a truck (gate entry and GRN)", "store", async (page) => {
      await caption(page, "store", "Home is a task inbox: trucks at the gate, POs to receive, lots to put away, requests to issue.");
      await open(page, "/grn");
      await caption(page, "store", "A truck has arrived. Stores › Gate entry & GRN › New GRN.");
      await page.getByRole("button", { name: "New GRN" }).click();
      await page.locator('select[name="po"]').selectOption(po.id);
      await caption(page, "store", `Pick the supplier PO the truck is delivering against: ${po.poNumber} from ${po.supplier.name}.`);
      await page.getByRole("button", { name: "Load" }).click();
      await page.waitForURL(/po=/);
      await page.waitForLoadState("networkidle");
      await caption(page, "store", "Record the vehicle and the supplier's invoice, and the COA (mandatory for automotive).");
      await typeInto(page.locator('input[name="vehicleNumber"]'), "MH12 QX 4471");
      await typeInto(page.locator('input[name="invoiceNumber"]'), "INV-88231");
      await typeInto(page.locator('input[name="coaUrl"]'), `COA-${heat}`);
      await caption(page, "store", `Count what came in (${receiveQty} ${poLine.item.uom} of ${poLine.item.code}) and note the resin maker's heat number.`);
      await page.locator(`[name="qty_${poLine.id}"]`).fill(String(receiveQty));
      await typeInto(page.locator(`[name="lot_${poLine.id}"]`), heat);
      await page.locator(`[name="bags_${poLine.id}"]`).fill(String(Math.max(1, Math.round(receiveQty / 25))));
      await submit(page, page.getByRole("button", { name: "Post GRN" }), "Posting the GRN");
      await caption(page, "store", "GRN posted. The lot waits in staging as Pending QC, and QA gets a task and a phone notification.");
      await open(page, "/stock?view=bins");
      await caption(page, "store", "The bin map: the new lot sits in Staging until QA releases it. Nothing can be issued from it yet.");
    });

    // The lot just received (or, when starting later, the newest received lot).
    const lot = await db.lot.findFirstOrThrow({ where: at(1) && poLine ? { grnLine: { poLineId: poLine.id } } : { grnLineId: { not: null } }, orderBy: { receivedAt: "desc" } });

    // 2 · QA inspects and releases it
    if (at(2)) await chapter(browser, "02 QA Inspector - inward QC and release", "qa", async (page) => {
      await caption(page, "qa", "QA's Home: the QC queue (inward, first-off, final) with the oldest waiting first.");
      await open(page, `/quality?tab=inward&lot=${lot.lotNumber}`);
      const card = page.locator(`#lot-${lot.lotNumber}`);
      await card.scrollIntoViewIfNeeded();
      await caption(page, "qa", `Quality › Inward QC. Lot ${lot.lotNumber}: check the COA, count the bags, test a sample.`);
      await typeInto(card.locator('input[name="mfi"]'), "11.8");
      await typeInto(card.locator('input[name="moisture"]'), "0.03");
      await typeInto(card.locator('input[name="density"]'), "0.905");
      await typeInto(card.locator('input[name="tensile"]'), "33.5");
      const bin = await card.locator('select[name="bin"] option').nth(1).getAttribute("value");
      if (bin) await card.locator('select[name="bin"]').selectOption(bin);
      await caption(page, "qa", `Results are in spec. Approve and put it away in bin ${bin ?? "(staging)"} in the same step.`);
      await submit(page, card.getByRole("button", { name: "Approve" }), "Approving the lot");
      await page.getByText("RECENTLY DECIDED").scrollIntoViewIfNeeded();
      await caption(page, "qa", "Released. The test results, COA and QR tag are kept per lot, and the lot is now usable stock.");
    });

    // Pick a part whose resin and masterbatch are in stock, preferring one moulded from the resin just received.
    const boms = await db.bom.findMany({ include: { fgItem: true, mould: true, lines: { include: { item: true } } } });
    const usable = async (itemId: string) => db.lot.findMany({
      where: { itemId, qcStatus: { in: ["APPROVED", "DEVIATED"] }, balances: { some: { qty: { gt: 0 }, location: { type: "STORAGE" } } } },
      orderBy: { receivedAt: "asc" }, include: { balances: { where: { qty: { gt: 0 }, location: { type: "STORAGE" } } } },
    });
    const ranked = [...boms].sort((a, b) => Number(b.lines.some((l) => l.itemId === lot.itemId)) - Number(a.lines.some((l) => l.itemId === lot.itemId)));
    let bom: (typeof boms)[number] | undefined;
    for (const b of ranked) {
      const blend = b.lines.filter((l) => l.kind === "RESIN" || l.kind === "MASTERBATCH");
      if (blend.length && (await Promise.all(blend.map((l) => usable(l.itemId)))).every((x) => x.length > 0)) { bom = b; break; }
    }
    if (!bom) throw new Error("No BOM has its resin and masterbatch in stock.");
    const resin = bom.lines.find((l) => l.kind === "RESIN")!;
    const machine = await db.machine.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
    if ((await db.appSetting.findUnique({ where: { key: "requireFirstOff" } }))?.value === "1") {
      throw new Error("The plant rule 'first-off before booking' is on; this script does not record the first-off step yet.");
    }

    // 3 · Production asks for material
    if (at(3)) await chapter(browser, "03 Production Lead - request material for a machine", "production", async (page) => {
      await caption(page, "production", "Production's Home: my machines this shift, with the plan, last booking and material at each machine.");
      await open(page, "/requests");
      await caption(page, "production", `Before the run on ${machine.code}, ask stores for resin. Material requests › New requisition.`);
      await page.getByRole("button", { name: "New requisition" }).click();
      await page.locator('select[name="itemId"]').selectOption(resin.itemId);
      await page.locator('input[name="qty"]').first().fill("20");
      await page.locator('select[name="machineId"]').selectOption(machine.id);
      await caption(page, "production", `20 ${resin.item.uom} of ${resin.item.code} for ${machine.code}. Production can ask, but can't issue from the store.`);
      await submit(page, page.getByRole("button", { name: "Raise request" }), "Raising the request");
      await caption(page, "production", "Request raised. Store Incharge now has it in their inbox under Requests to issue.");
    });

    const request = await db.materialRequest.findFirstOrThrow({ orderBy: { createdAt: "desc" } });

    // 4 · Store issues it, oldest lot first
    if (at(4)) await chapter(browser, "04 Store Incharge - issue material FIFO", "store", async (page) => {
      await open(page, "/requests");
      const card = page.locator("form", { hasText: request.requestNumber }).first();
      await card.scrollIntoViewIfNeeded();
      await caption(page, "store", `Request ${request.requestNumber}. The app lists lots oldest first and fills in the lot that must go (FIFO).`);
      await caption(page, "store", "Scan the lot tag and the bin (or check what is filled in), confirm the quantity, Issue. A newer lot needs a written reason.");
      await submit(page, card.getByRole("button", { name: "Issue" }), "Issuing the material");
      await caption(page, "store", "Issued. The ledger records the lot, bin, machine and who issued it.");
    });

    // The material fed to the machine: the oldest usable lot of each resin and masterbatch, at the BOM's blend.
    const shots = 200;
    const shotKg = (bom.mould.cavities * Number(bom.partWeightG) + Number(bom.mould.runnerWeightG ?? 0)) * shots / 1000;
    const fed: { lotNumber: string; qty: number }[] = [];
    for (const l of bom.lines.filter((x) => x.kind === "RESIN" || x.kind === "MASTERBATCH")) {
      const [first] = await usable(l.itemId);
      fed.push({ lotNumber: first.lotNumber, qty: Math.max(0.01, Math.round(shotKg * Number(l.pct ?? 0)) / 100) });
    }
    const rejects = 6;
    const good = shots * bom.mould.cavities - rejects;

    // 5 · Production books the run and packs it
    if (at(5)) await chapter(browser, "05 Production Lead - book production and pack boxes", "production", async (page) => {
      await open(page, "/production");
      await caption(page, "production", "End of the hour: Production › Book production.");
      await page.getByRole("button", { name: "Book production" }).first().click();
      const form = page.locator("form", { has: page.locator('select[name="bomId"]') });
      await form.locator('select[name="bomId"]').selectOption(bom.id);
      await form.locator('select[name="machineId"]').selectOption(machine.id);
      await caption(page, "production", `Part ${bom.fgItem.code}. The picker shows its blend and the regrind limit the run must stay within.`);
      await form.locator('input[name="shots"]').fill(String(shots));
      await form.locator('input[name="goodParts"]').fill(String(good));
      await form.locator('input[name="rejectParts"]').fill(String(rejects));
      await caption(page, "production", `${shots} shots: ${good} good parts, ${rejects} rejects. The runner weight can come straight from the scale.`);
      for (const [i, f] of fed.entries()) {
        await typeInto(form.locator(`input[name="lot_${i}"]`), f.lotNumber);
        await form.locator(`input[name="lotqty_${i}"]`).fill(String(f.qty));
      }
      await caption(page, "production", "Scan the tag of every lot fed into the hopper. This is what links each box back to the resin heat number.");
      await submit(page, form.getByRole("button", { name: "Book production" }), "Booking production");
      await caption(page, "production", "Booked. Good parts became a finished-goods lot, runners became regrind, rejects went to QA.");

      await open(page, "/fg?tab=pack");
      const fgLot = await db.lot.findFirstOrThrow({ where: { itemId: bom.fgItemId }, orderBy: { receivedAt: "desc" } });
      await caption(page, "production", "Finished goods › Pack & label: box the parts in the customer's format and print the labels.");
      await page.getByRole("button", { name: "Create boxes" }).first().click();
      const packForm = page.locator("form", { has: page.locator('select[name="source"]') });
      const src = await packForm.locator('select[name="source"] option', { hasText: fgLot.lotNumber }).first().getAttribute("value");
      if (src) await packForm.locator('select[name="source"]').selectOption(src);
      const demand = await db.demandLine.findFirst({ where: { fgItemId: bom.fgItemId }, orderBy: { dueDate: "asc" } });
      if (demand) await packForm.locator('select[name="customerId"]').selectOption(demand.customerId);
      await packForm.locator('input[name="qtyPerBox"]').fill(String(Math.floor(good / 4)));
      await packForm.locator('input[name="boxCount"]').fill("4");
      await caption(page, "production", `4 boxes of ${Math.floor(good / 4)} for the customer. OEM labels carry part, batch, shift, machine, qty and date.`);
      await submit(page, packForm.getByRole("button", { name: "Create boxes" }), "Packing the boxes");
      await caption(page, "production", "Boxes labelled. They can't ship until QA does the final inspection.");
    });

    const booking = await db.productionBooking.findFirstOrThrow({ orderBy: { producedAt: "desc" } });
    const fgLot = await db.lot.findUniqueOrThrow({ where: { id: booking.fgLotId! } });

    // 6 · QA releases the lot and decides the rejects
    if (at(6)) await chapter(browser, "06 QA Inspector - final inspection (PDI) and scrap decision", "qa", async (page) => {
      await open(page, "/quality?tab=pdi");
      const lotCard = page.locator("article", { hasText: fgLot.lotNumber }).first();
      if (await lotCard.count()) {
        await lotCard.scrollIntoViewIfNeeded();
        await caption(page, "qa", `Final inspection: sample the boxes of lot ${fgLot.lotNumber}, then release it for dispatch (or hold it).`);
        await submit(page, lotCard.getByRole("button", { name: "Release" }), "Releasing the lot");
        await caption(page, "qa", "Released. Dispatch now sees these boxes as ready to ship.");
      }
      await open(page, "/quality?tab=scrap");
      const scrap = page.locator("form", { has: page.locator(`input[name="bookingId"][value="${booking.id}"]`) }).first();
      await scrap.scrollIntoViewIfNeeded();
      await caption(page, "qa", `The ${rejects} rejects from that booking: crush into regrind (only parts without inserts) or scrap as waste.`);
      const regrind = scrap.getByRole("button", { name: "Crush into regrind" });
      await submit(page, (await regrind.isEnabled()) ? regrind : scrap.getByRole("button", { name: "Scrap as waste" }), "Deciding the scrap");
      await caption(page, "qa", "Decided. Regrind goes back to stock as its own lot, still traceable to the resin it came from.");
    });

    const boxes = await db.fgBox.findMany({ where: { lotId: fgLot.id, status: "IN_STOCK" }, include: { customer: true }, orderBy: { boxCode: "asc" } });
    if (!boxes.length) throw new Error("No packed boxes to ship.");
    const shipQty = boxes.reduce((s, b) => s + b.qty, 0);

    // 7 · Dispatch picks, loads and ships
    await chapter(browser, "07 Dispatch Officer - pick, load and ship", "dispatch", async (page) => {
      await caption(page, "dispatch", "Dispatch's Home: today's shipments, with finished goods ready per customer.");
      // A pick list left loading by an earlier, interrupted run is picked up again rather than duplicated.
      const left = await db.dispatch.findFirst({ where: { status: "LOADING", customerId: boxes[0].customerId, lines: { some: { itemId: fgLot.itemId, qty: shipQty } } }, orderBy: { createdAt: "desc" } });
      if (left) {
        await open(page, `/dispatch/${left.id}`);
      } else {
        await open(page, "/orders?new=dispatch");
        await caption(page, "dispatch", `Orders › New pick list for ${boxes[0].customer.name}: the part and how many to load.`);
        const form = page.locator("form", { has: page.locator('select[name="customerId"]') }).first();
        await form.locator('select[name="customerId"]').selectOption(boxes[0].customerId);
        await form.locator('select[name="itemId"]').first().selectOption(fgLot.itemId);
        await form.locator('input[name="qty"]').first().fill(String(shipQty));
        await form.getByRole("button", { name: /Create & start loading/ }).click();
        await page.waitForURL(/\/dispatch\/[^/?]+/, { timeout: 25_000 });
        await page.waitForLoadState("networkidle");
      }
      await caption(page, "dispatch", "At the truck: scan each box label. Wrong part, wrong customer, a repeat or an unreleased box is refused.");
      for (const b of boxes) {
        await typeInto(page.locator('input[name="scan"]'), b.boxCode);
        await submit(page, page.getByRole("button", { name: "Load box", exact: true }), `Loading box ${b.boxCode}`);
      }
      await caption(page, "dispatch", "Every box is on. Complete the dispatch: stock is deducted only now.");
      await submit(page, page.getByRole("button", { name: "Complete & dispatch" }), "Completing the dispatch");
      await caption(page, "dispatch", "Shipped: delivery challan, packing list and e-way bill data are ready, and the customer's order line is closed.");
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(1500);
    });
  } finally {
    await browser.close();
    await db.$disconnect();
  }
  console.log(`Videos in ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
