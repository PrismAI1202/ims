// Builds the narrated demo film from the role recordings (scripts/record-flows.ts): animated title and explainer cards,
// a card before each step, each recording framed and voiced, cross-fades between them, and a subtitle file.
//
//   npm run record:flows   then   npm run demo:video
//
// Needs ffmpeg (brew install ffmpeg) and macOS `say` for the voice (VOICE=Aman by default, an Indian English voice).
// Output: ../recordings/IMS demo.mp4 and IMS demo.srt
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";

// DEVICE=phone builds the phone film from ../recordings/mobile (record with DEVICE=phone): each recording sits in a phone
// on the right, with the step and its live captions beside it.
const PHONE = process.env.DEVICE === "phone";
const REC = path.resolve(process.cwd(), process.env.RECORD_DIR ?? (PHONE ? "../recordings/mobile" : "../recordings"));
const FILM = PHONE ? "IMS demo (mobile)" : "IMS demo";
const WORK = process.env.WORK_DIR ?? path.join(os.tmpdir(), PHONE ? "ims-demo-build-phone" : "ims-demo-build");
// Where the phone screen sits in the 1920 × 1080 frame (390 × 844 at the same proportions).
const SCREEN = { x: 1220, y: 70, w: 434, h: 940 };
const VOICE = process.env.VOICE ?? "Aman";
const RATE = process.env.VOICE_RATE ?? "168";
const W = 1920, H = 1080, FPS = 30, FADE = 0.7, LEAD = 0.6, TAIL = 0.9;

const ROLES = {
  store: { name: "Store Incharge", color: "#2FA36B" },
  qa: { name: "QA Inspector", color: "#4C7DF0" },
  production: { name: "Production Lead", color: "#9A7BE0" },
  dispatch: { name: "Dispatch Officer", color: "#D9973A" },
} as const;
type Role = keyof typeof ROLES;

type Scene =
  | { kind: "card"; id: string; html: string; say: string; transition?: string }
  | { kind: "clip"; id: string; file: string; role: Role; step: number; title: string; where: string; say: string; transition?: string };

// ───────── Cards ─────────

const CSS = `
:root { --bg:#0E1215; --panel:#161B20; --line:#27303A; --fg:#EEF1F4; --muted:#94A0AD; --accent:#E8763A; --store:#2FA36B; --qa:#4C7DF0; --prod:#9A7BE0; --disp:#D9973A;
  --display:"Avenir Next Condensed","Arial Narrow",sans-serif; --body:"Avenir Next","Helvetica Neue",sans-serif; --mono:Menlo,monospace; }
* { box-sizing:border-box; margin:0 }
html,body { width:${W}px; height:${H}px; overflow:hidden; background:var(--bg); color:var(--fg); font-family:var(--body) }
body::before { content:""; position:absolute; inset:0; background:
  radial-gradient(1200px 700px at 85% 10%, rgba(232,118,58,.13), transparent 60%),
  radial-gradient(900px 600px at 0% 100%, rgba(76,125,240,.10), transparent 60%);
  animation: drift var(--d) linear both }
body::after { content:""; position:absolute; inset:0; background-image:linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size:96px 96px; opacity:.22; mask-image:radial-gradient(ellipse at center, #000 30%, transparent 75%) }
@keyframes drift { from { transform:scale(1.04) translate(-12px,0) } to { transform:scale(1) translate(12px,0) } }
.stage { position:relative; z-index:1; height:100%; padding:110px 140px; display:flex; flex-direction:column; justify-content:center; gap:34px }
.eyebrow { font:600 22px/1 var(--body); letter-spacing:.22em; text-transform:uppercase; color:var(--accent) }
h1 { font:700 104px/1.0 var(--display); letter-spacing:-.01em; max-width:1500px }
h2 { font:700 72px/1.05 var(--display); max-width:1500px }
p.lede { font:400 34px/1.45 var(--body); color:var(--muted); max-width:1250px }
.in { opacity:0; animation: rise .9s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(var(--d) * var(--at, 0)) }
@keyframes rise { from { opacity:0; transform:translateY(26px) } to { opacity:1; transform:none } }
.pop { opacity:0; animation: pop .7s cubic-bezier(.2,.9,.3,1.2) both; animation-delay: calc(var(--d) * var(--at, 0)) }
@keyframes pop { from { opacity:0; transform:scale(.85) } to { opacity:1; transform:none } }
.bar { height:8px; width:0; background:var(--accent); border-radius:4px; animation: grow 1.2s ease-out both; animation-delay: calc(var(--d) * var(--at, 0)) }
@keyframes grow { to { width:var(--w, 260px) } }
.chip { display:inline-flex; align-items:center; gap:10px; padding:8px 18px; border-radius:999px; font:700 24px/1 var(--body); color:#0E1215; background:var(--c) }
.row { display:flex; gap:28px; align-items:stretch }
.box { background:var(--panel); border:1px solid var(--line); border-radius:22px; padding:32px 34px; display:flex; flex-direction:column; gap:14px }
.box h3 { font:700 40px/1.1 var(--display) }
.box li { font:400 27px/1.45 var(--body); color:#C9D1D9; list-style:none; padding-left:30px; position:relative }
.box li::before { content:""; position:absolute; left:4px; top:17px; width:12px; height:12px; border-radius:3px; background:var(--c, var(--accent)) }
.mono { font-family:var(--mono) }
`;

const page = (d: number, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body style="--d:${d}s"><div class="stage">${body}</div></body></html>`;

const cards = {
  title: (d: number) => page(d, `
    <div class="in eyebrow" style="--at:.02">Crimson · Plant 2 moulding shop${PHONE ? " · on a phone" : ""}</div>
    <h1 class="in" style="--at:.06">IMS: inventory and traceability<br>for an injection moulding plant</h1>
    <div class="bar" style="--at:.14;--w:340px"></div>
    <p class="in lede" style="--at:.2">How material moves from the supplier's truck to the customer's dock, and what each person does in the app, step by step.</p>
    <div class="in row" style="--at:.45;gap:14px">${(Object.keys(ROLES) as Role[]).map((r) => `<span class="chip" style="--c:${ROLES[r].color}">${ROLES[r].name}</span>`).join("")}</div>`),

  moulding: (d: number) => page(d, `
    <div class="in eyebrow" style="--at:.01">The industry</div>
    <h2 class="in" style="--at:.03">One shot: pellets in, a finished part out</h2>
    <svg viewBox="0 0 1640 560" width="1640" height="560" style="overflow:visible">
      <defs><linearGradient id="heat" x1="0" x2="1"><stop offset="0" stop-color="#E8763A" stop-opacity=".25"/><stop offset="1" stop-color="#E8763A" stop-opacity=".85"/></linearGradient></defs>
      <!-- hopper -->
      <g class="in" style="--at:.08">
        <path d="M120 40 h200 l-60 150 h-80 z" fill="#1E252C" stroke="#3A4651" stroke-width="3"/>
        ${Array.from({ length: 14 }, (_, i) => `<circle cx="${150 + (i % 7) * 22}" cy="${70 + Math.floor(i / 7) * 26}" r="9" fill="${i % 5 === 0 ? "#4C7DF0" : "#D8DEE4"}"/>`).join("")}
        <text x="220" y="20" fill="#94A0AD" font-size="24" text-anchor="middle" font-family="Avenir Next">Resin + masterbatch</text>
      </g>
      ${Array.from({ length: 6 }, (_, i) => `<circle cx="220" cy="200" r="7" fill="#D8DEE4" style="animation: fall 1.6s linear ${i * 0.27}s infinite"/>`).join("")}
      <style>@keyframes fall { 0% { transform:translateY(0); opacity:1 } 100% { transform:translateY(90px); opacity:0 } }
        @keyframes shut { 0%,15% { transform:translateX(0) } 35%,70% { transform:translateX(-38px) } 90%,100% { transform:translateX(0) } }
        @keyframes eject { 0%,70% { opacity:0; transform:translate(0,0) } 80% { opacity:1; transform:translate(0,0) } 100% { opacity:0; transform:translate(0,120px) } }
        @keyframes flow { to { stroke-dashoffset:-60 } }</style>
      <!-- barrel + screw -->
      <g class="in" style="--at:.16">
        <rect x="140" y="250" width="760" height="110" rx="18" fill="url(#heat)" stroke="#3A4651" stroke-width="3"/>
        ${Array.from({ length: 6 }, (_, i) => `<rect x="${200 + i * 115}" y="236" width="56" height="138" rx="8" fill="#2A323B" opacity=".9"/>`).join("")}
        <path d="M170 305 H880" stroke="#FCE2D2" stroke-width="10" stroke-dasharray="26 34" style="animation: flow .8s linear infinite"/>
        <text x="560" y="222" fill="#94A0AD" font-size="24" text-anchor="middle" font-family="Avenir Next">Heated barrel melts it · the screw injects the melt</text>
      </g>
      <!-- mould -->
      <g class="in" style="--at:.3">
        <rect x="930" y="200" width="150" height="210" rx="10" fill="#33404C" stroke="#4E5D6B" stroke-width="3" style="animation: shut 4s ease-in-out infinite"/>
        <rect x="1080" y="200" width="150" height="210" rx="10" fill="#2A3540" stroke="#4E5D6B" stroke-width="3"/>
        <rect x="1060" y="270" width="40" height="70" rx="6" fill="#E8763A" style="animation: eject 4s ease-in-out infinite"/>
        <text x="1080" y="185" fill="#94A0AD" font-size="24" text-anchor="middle" font-family="Avenir Next">Steel mould: cools, opens, ejects</text>
      </g>
      <!-- part -->
      <g class="pop" style="--at:.42">
        <rect x="1330" y="250" width="200" height="110" rx="16" fill="#1E252C" stroke="#E8763A" stroke-width="3"/>
        <text x="1430" y="314" fill="#EEF1F4" font-size="30" text-anchor="middle" font-family="Avenir Next Condensed" font-weight="700">Part</text>
        <path d="M1240 305 h80" stroke="#E8763A" stroke-width="4" marker-end="url(#a)"/>
      </g>
      <!-- regrind loop -->
      <g class="in" style="--at:.62">
        <path d="M1150 420 C1150 540, 260 560, 220 220" fill="none" stroke="#4C7DF0" stroke-width="4" stroke-dasharray="14 12" style="animation: flow 1.2s linear infinite"/>
        <rect x="560" y="470" width="520" height="70" rx="35" fill="#16233F" stroke="#4C7DF0" stroke-width="2"/>
        <text x="820" y="514" fill="#C9D7FF" font-size="26" text-anchor="middle" font-family="Avenir Next">Runner &amp; sprue → crushed → regrind (up to a limit)</text>
      </g>
    </svg>`),

  segments: (d: number) => page(d, `
    <div class="in eyebrow" style="--at:.01">Two kinds of customer</div>
    <h2 class="in" style="--at:.03">Different rules, applied automatically</h2>
    <div class="row">
      <div class="box in" style="--at:.08;flex:1;--c:var(--accent)"><h3>Automotive (OEM, Tier-1)</h3><ul>
        <li class="in" style="--at:.14">Trace every box back to the resin heat lot</li>
        <li class="in" style="--at:.2">Certificate of analysis (COA) before receipt</li>
        <li class="in" style="--at:.26">Kanban buffers, just-in-time call-offs</li>
        <li class="in" style="--at:.32">Customer label formats, returnable crates</li></ul></div>
      <div class="box in" style="--at:.5;flex:1;--c:var(--qa)"><h3>Non-automotive</h3><ul>
        <li class="in" style="--at:.56">Purchase orders and spot orders</li>
        <li class="in" style="--at:.62">Reorder-point replenishment</li>
        <li class="in" style="--at:.68">Standard boxes, generic labels</li>
        <li class="in" style="--at:.74">Same FIFO, QC and dispatch checks</li></ul></div>
    </div>`),

  flow: (d: number) => {
    const steps: [string, string, string][] = [
      ["Customer order", "Planner", "--accent"], ["MRP & purchase", "Planner", "--accent"], ["Inward & QC", "Store · QA", "--store"],
      ["Store", "Store", "--store"], ["Production", "Production · Store", "--prod"], ["Dispatch", "Dispatch", "--disp"],
    ];
    return page(d, `
      <div class="in eyebrow" style="--at:.01">The plant</div>
      <h2 class="in" style="--at:.03">Material moves in six stages</h2>
      <div class="row" style="gap:18px;align-items:center">${steps.map(([t, who, c], i) => `
        <div class="box pop" style="--at:${(0.1 + i * 0.1).toFixed(2)};flex:1;padding:26px 22px;border-color:var(${c});min-height:210px">
          <span class="mono" style="color:var(${c});font-size:26px">0${i + 1}</span>
          <h3 style="font-size:36px">${t}</h3>
          <span style="color:var(--muted);font-size:23px">${who}</span>
        </div>${i < steps.length - 1 ? `<span class="in" style="--at:${(0.14 + i * 0.1).toFixed(2)};font-size:40px;color:var(--muted)">→</span>` : ""}`).join("")}
      </div>
      <div class="row in" style="--at:.78;gap:16px;flex-wrap:wrap">
        ${["Low stock re-runs MRP", "Runners return as regrind", "Crates come back from the customer"].map((x) => `<span class="chip" style="--c:#2A323B;color:var(--fg);font-weight:600">↻ ${x}</span>`).join("")}
      </div>`);
  },

  roles: (d: number) => page(d, `
    <div class="in eyebrow" style="--at:.01">Who does what</div>
    <h2 class="in" style="--at:.03">Four roles, each with its own inbox</h2>
    <div class="row">${([
      ["store", "Receives trucks, stores lots, issues material oldest first"],
      ["qa", "Inward QC, final inspection, scrap decisions"],
      ["production", "Requests material, books output, packs boxes"],
      ["dispatch", "Picks, loads and ships; tracks crates"],
    ] as [Role, string][]).map(([r, t], i) => `
      <div class="box in" style="--at:${(0.1 + i * 0.08).toFixed(2)};flex:1;border-top:6px solid ${ROLES[r].color}">
        <h3 style="color:${ROLES[r].color}">${ROLES[r].name}</h3><p style="font-size:26px;line-height:1.45;color:#C9D1D9">${t}</p></div>`).join("")}
    </div>
    <p class="in lede" style="--at:.55">Finishing a step creates the next person's task, with a notification on their phone.</p>`),

  step: (d: number, n: number, role: Role, title: string, where: string) => page(d, `
    <div class="row" style="align-items:center;gap:60px">
      <span class="pop" style="--at:.02;font:700 300px/0.85 var(--display);color:${ROLES[role].color}">${n}</span>
      <div style="display:flex;flex-direction:column;gap:26px">
        <span class="in chip" style="--at:.08;--c:${ROLES[role].color};align-self:flex-start">${ROLES[role].name}</span>
        <h2 class="in" style="--at:.12">${title}</h2>
        <p class="in lede mono" style="--at:.22;font-size:28px">In the app: ${where}</p>
      </div>
    </div>`),

  trace: (d: number) => page(d, `
    <div class="in eyebrow" style="--at:.01">What the records give you</div>
    <h2 class="in" style="--at:.03">Any box, traced back in one search</h2>
    <div class="row" style="gap:14px;align-items:center">${["Customer box tag", "Machine · shift", "Mould", "Resin heat lot", "Supplier GRN & COA"].map((t, i) => `
      <div class="box pop" style="--at:${(0.08 + i * 0.07).toFixed(2)};flex:1;padding:22px;text-align:center"><h3 style="font-size:32px">${t}</h3></div>
      ${i < 4 ? `<span class="in" style="--at:${(0.1 + i * 0.07).toFixed(2)};font-size:36px;color:var(--accent)">→</span>` : ""}`).join("")}
    </div>
    <div class="row" style="gap:20px">${[["Live stock", "Red · yellow · green"], ["Traceability", "Recall from a heat number"], ["BOM vs actual", "Material used vs planned"], ["Crate ledger", "Issued vs returned"]].map(([t, s], i) => `
      <div class="box in" style="--at:${(0.58 + i * 0.07).toFixed(2)};flex:1"><h3 style="font-size:34px">${t}</h3><span style="color:var(--muted);font-size:24px">${s}</span></div>`).join("")}
    </div>`),

  close: (d: number) => page(d, `
    <div class="in eyebrow" style="--at:.02">IMS · Crimson</div>
    <h1 class="in" style="--at:.06">From the gate to the dock,<br>every hand-over tracked</h1>
    <div class="bar" style="--at:.2;--w:420px"></div>
    <p class="in lede" style="--at:.3">Receive · inspect · store · issue · mould · inspect · ship. One record of every gram that moves.</p>`),

  // Phone film: the step beside the phone (the screen area is left black for the recording).
  phoneFrame: (n: number, role: Role, title: string, where: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
    body::before,body::after{animation:none}</style></head><body style="--d:1s">
    <div style="position:absolute;left:150px;top:150px;width:900px;display:flex;flex-direction:column;gap:28px">
      <div style="display:flex;align-items:center;gap:18px"><span class="chip" style="--c:${ROLES[role].color}">${ROLES[role].name}</span>
        <span style="color:var(--muted);font:600 28px/1 var(--body)">Step ${n} of 7 · on a phone</span></div>
      <h2 style="font-size:84px">${title}</h2>
      <p class="mono" style="color:var(--muted);font-size:28px">In the app: ${where}</p>
      <div class="bar" style="animation:none;width:220px"></div>
    </div>
    <div style="position:absolute;left:${SCREEN.x}px;top:${SCREEN.y}px;width:${SCREEN.w}px;height:${SCREEN.h}px;background:#000;box-shadow:0 40px 90px rgba(0,0,0,.6)"></div>
  </body></html>`,
  // The phone's body, drawn over the recording; its inner corners round off the screen.
  phoneBezel: () => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body>
    <div style="position:absolute;left:${SCREEN.x - 16}px;top:${SCREEN.y - 16}px;width:${SCREEN.w}px;height:${SCREEN.h}px;border:16px solid #1B2026;border-radius:62px;outline:2px solid #3A434D"></div>
    <div style="position:absolute;left:${SCREEN.x + SCREEN.w / 2 - 60}px;top:${SCREEN.y + 10}px;width:120px;height:30px;border-radius:15px;background:#1B2026"></div>
  </body></html>`,
  // One caption beside the phone, shown while that part of the recording plays.
  cue: (text: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
    html,body{background:transparent}body::before,body::after{display:none}</style></head><body>
    <p style="position:absolute;left:150px;top:600px;width:900px;font:500 40px/1.4 var(--body);color:var(--fg)">${text}</p>
  </body></html>`,

  // The frame around a recording: step, role and title above it.
  frame: (n: number, role: Role, title: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
    body::before,body::after{animation:none}</style></head><body style="--d:1s">
    <div style="position:absolute;left:176px;top:22px;display:flex;align-items:center;gap:18px;font:600 30px/1 var(--body)">
      <span class="chip" style="--c:${ROLES[role].color}">${ROLES[role].name}</span>
      <span style="color:var(--muted)">Step ${n} of 7</span><span>${title}</span></div>
    <div style="position:absolute;left:170px;top:74px;width:1580px;height:992px;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.55);background:#000"></div>
  </body></html>`,
};

// ───────── The film ─────────

const STEP_CLIPS: { file: string; role: Role; title: string; where: string; card: string; say: string }[] = [
  {
    file: "01 Store Incharge - receive a truck (gate entry and GRN)", role: "store", title: "Receive a truck", where: "Stores › Gate entry & GRN",
    card: "Step one. The store incharge receives a truck.",
    say: "The store incharge signs in and lands on a task inbox, not a menu. Under Stores, Gate entry and G R N, they pick the purchase order the truck is delivering against. They record the vehicle, the supplier's invoice, and the certificate of analysis, which is mandatory for automotive material. They count what arrived and note the resin maker's heat number, which is what makes the lot traceable. Once the G R N is posted, the material waits in staging as pending Q C. It can't be used yet, and Q A is notified straight away.",
  },
  {
    file: "02 QA Inspector - inward QC and release", role: "qa", title: "Inspect and release the lot", where: "Quality › Inward QC",
    card: "Step two. Q A inspects the material.",
    say: "The Q A inspector opens the lot from the Q C queue. They check the certificate, count the bags, and enter the lab results: melt flow, moisture, density and tensile strength. The results are in specification, so the lot is approved, and put away into a storage bin in the same step. A failed lot would be rejected and sent back to the supplier with a debit note. The results stay with the lot, and a Q R tag can be printed for it.",
  },
  {
    file: "03 Production Lead - request material for a machine", role: "production", title: "Ask stores for material", where: "Material requests › New requisition",
    card: "Step three. Production asks for material.",
    say: "Before a run, the production lead asks stores for material: the resin, the quantity, and the machine it's for. Production can ask for material, but can't take it from the store. The request goes straight to the store incharge's inbox.",
  },
  {
    file: "04 Store Incharge - issue material FIFO", role: "store", title: "Issue the oldest lot first", where: "Material requests › To issue",
    card: "Step four. Stores issues the material.",
    say: "The app lists the approved lots oldest first, and fills in the lot that must go, so material is always used first in, first out. The store incharge scans the lot and the bin, confirms the quantity, and issues it. Taking a newer lot is only possible with a written reason, which the admin can review.",
  },
  {
    file: "05 Production Lead - book production and pack boxes", role: "production", title: "Book the run and pack it", where: "Production · Finished goods › Pack & label",
    card: "Step five. Production books the run and packs it.",
    say: "After the run, production books its output: the part, the machine, the shots, good parts and rejects. The part picker shows the blend, and the regrind limit this grade must stay within. They scan the tag of every lot fed into the hopper. That is the link from a finished box back to the resin. Good parts become a finished-goods lot, runners become regrind stock, and rejects go to Q A. Then the parts are packed into boxes and labelled in the customer's own format.",
  },
  {
    file: "06 QA Inspector - final inspection (PDI) and scrap decision", role: "qa", title: "Final inspection and scrap", where: "Quality › Final inspection · Scrap",
    card: "Step six. Q A releases the finished goods.",
    say: "Before anything ships, Q A inspects the finished lot and releases it, or puts it on hold. Then they decide what happens to the rejects from that run: crush them into regrind, which is allowed only for parts without metal inserts, or scrap them as waste.",
  },
  {
    file: "07 Dispatch Officer - pick, load and ship", role: "dispatch", title: "Pick, load and ship", where: "Orders › New pick list · Dispatch",
    card: "Step seven. Dispatch loads the truck.",
    say: "The dispatch officer creates a pick list for the customer, then scans each box as it goes onto the truck. A wrong part, a wrong customer, a box scanned twice, or a box Q A hasn't released is refused on the spot. When every box is on, they complete the dispatch. Only then is stock deducted. The delivery challan, packing list and e-way bill data are ready, and the customer's order closes automatically.",
  },
];

const SCENES: Scene[] = [
  { kind: "card", id: "title", html: "title", say: PHONE
    ? "This is IMS, the inventory and traceability system for Crimson's injection moulding plant, on a phone. Every screen works at phone width, so people at the gate, in the store and on the shop floor can do their step where they stand. Let's follow material through the plant, step by step."
    : "This is IMS, the inventory and traceability system for Crimson's injection moulding plant. In the next few minutes we'll follow material through the plant, and see how each person uses the app to move it, step by step." },
  { kind: "card", id: "moulding", html: "moulding", say: "First, the process. Plastic pellets, called resin, are mixed with a little colour masterbatch and fed into the hopper. A heated barrel melts them, and a screw injects the melt into a steel mould. The part cools and is ejected. That one cycle is called a shot. The plastic left in the channels, the runner and sprue, is crushed into regrind and mixed back in, but only up to a limit, because too much regrind weakens the part." },
  { kind: "card", id: "segments", html: "segments", say: "The plant serves two kinds of customer. Automotive customers need every box traceable back to the resin lot, a certificate of analysis before material is accepted, Kanban stock buffers, and their own label formats. Non-automotive customers order against purchase orders, and stock is topped up at a reorder point. IMS applies the right rules automatically, based on the customer." },
  { kind: "card", id: "flow", html: "flow", say: "Material moves through six stages. Customer orders drive the M R P plan and the purchase orders. Trucks are received and checked by quality. Approved material is stored by rack, shelf and bin. It's issued to the machines and moulded. And finished goods are labelled and dispatched. Material also loops back: low stock triggers new purchases, runners return as regrind, and customer crates come back." },
  { kind: "card", id: "roles", html: "roles", say: "Four roles do the daily work: the store incharge, the Q A inspector, the production lead and the dispatch officer. Each signs in to their own home page, with an inbox of what is waiting for them. When one person finishes a step, the app creates the next person's task and notifies their phone. Let's follow one truck of resin all the way to the customer.", transition: "fadeblack" },
  ...STEP_CLIPS.flatMap((c, i): Scene[] => [
    { kind: "card", id: `step${i + 1}`, html: "step", say: c.card, transition: "smoothleft" },
    { kind: "clip", id: `clip${i + 1}`, file: c.file, role: c.role, step: i + 1, title: c.title, where: c.where, say: c.say, transition: "fade" },
  ]),
  { kind: "card", id: "trace", html: "trace", say: "Because every step is recorded, any finished box can be traced back: to the machine, the shift and the mould, to the resin heat lot, and to the supplier's G R N and certificate. From a single heat number, the app finds every customer who received parts made from it. And four live reports come out of the same records: stock health in red, yellow and green, traceability, B O M versus actual material use, and the returnable crate ledger.", transition: "fadeblack" },
  { kind: "card", id: "close", html: "close", say: "That's the full flow: from a truck at the gate to a box on the customer's dock, with every hand-over tracked, and every gram accounted for. Thank you for watching." },
];

// ───────── Building blocks ─────────

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).toString();
const ff = (args: string[]) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const duration = (file: string) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());

function voice(text: string, out: string) {
  const aiff = out.replace(/\.wav$/, ".aiff");
  run("say", ["-v", VOICE, "-r", RATE, "-o", aiff, text]);
  ff(["-i", aiff, "-ar", "48000", "-ac", "2", out]);
  return duration(out);
}

// Renders a card frame by frame: every CSS animation is paused and set to the frame's time, so timing is exact.
async function renderCard(p: Page, html: string, seconds: number, dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await p.setContent(html, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const frames = Math.ceil(seconds * FPS);
  for (let i = 0; i < frames; i++) {
    await p.evaluate((ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }, (i / FPS) * 1000);
    await p.screenshot({ path: path.join(dir, `f${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
  }
}

const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"];

async function main() {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    try { run(tool, ["-version"]); } catch { throw new Error(`${tool} is missing: brew install ffmpeg`); }
  }
  mkdirSync(WORK, { recursive: true });
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  const parts: { file: string; len: number; say: string; transition: string }[] = [];

  try {
    for (const s of SCENES) {
      const wav = path.join(WORK, `${s.id}.wav`);
      const talk = voice(s.say, wav);
      const out = path.join(WORK, `${s.id}.mp4`);

      if (s.kind === "card") {
        const len = LEAD + talk + TAIL;
        const c = STEP_CLIPS[Number(s.id.replace("step", "")) - 1];
        const html = s.html === "step" ? cards.step(len, Number(s.id.replace("step", "")), c.role, c.title, c.where) : (cards[s.html as "title"] as (d: number) => string)(len);
        const dir = path.join(WORK, s.id);
        await renderCard(p, html, len, dir);
        ff(["-framerate", String(FPS), "-i", path.join(dir, "f%05d.jpg"), "-i", wav,
          "-filter_complex", `[1:a]adelay=${LEAD * 1000}|${LEAD * 1000},apad[a]`, "-map", "0:v", "-map", "[a]", "-t", len.toFixed(3), ...ENC, out]);
        rmSync(dir, { recursive: true, force: true });
        parts.push({ file: out, len, say: s.say, transition: s.transition ?? "fade" });
      } else {
        const src = path.join(REC, `${s.file}.webm`);
        if (!existsSync(src)) throw new Error(`Missing recording: ${src}. Run npm run record:flows first.`);
        const fixed = path.join(WORK, `${s.id}-src.mkv`);
        ff(["-i", src, "-c", "copy", fixed]); // Playwright's webm has no duration; a remux gives it one
        const skip = 0.8; // the blank frames before the login page draws
        const clipLen = duration(fixed) - skip;
        // Speed long, quiet stretches up a little (never more than 1.6x) so the clip and the voice end together.
        const speed = Math.min(1.6, Math.max(1, clipLen / (talk + LEAD + TAIL)));
        const shown = clipLen / speed;
        const len = Math.max(shown, LEAD + talk + TAIL);
        const bg = path.join(WORK, `${s.id}-frame.png`);
        const shot = async (html: string, file: string, transparent = false) => {
          await p.setContent(html);
          await p.evaluate(() => document.fonts.ready);
          await p.screenshot({ path: file, omitBackground: transparent });
        };
        // A phone recording made at twice its size holds the screen in the top-left quarter; keep only that.
        const srcW = Number(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", fixed]).trim());
        const crop = PHONE && srcW >= 780 ? "crop=iw/2:ih/2:0:0," : "";
        const clipChain = (w: number, h: number) =>
          `[1:v]${crop}setpts=(PTS-STARTPTS)/${speed.toFixed(4)},fps=${FPS},scale=${w}:${h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${Math.max(0, len - shown + 1).toFixed(3)}[c]`;
        const voiceChain = `[2:a]adelay=${LEAD * 1000}|${LEAD * 1000},apad[a]`;
        if (!PHONE) {
          await shot(cards.frame(s.step, s.role, s.title), bg);
          ff(["-loop", "1", "-i", bg, "-ss", String(skip), "-i", fixed, "-i", wav, "-filter_complex",
            `${clipChain(1568, 980)};[0:v][c]overlay=176:80:shortest=0,format=yuv420p[v];${voiceChain}`,
            "-map", "[v]", "-map", "[a]", "-t", len.toFixed(3), ...ENC, out]);
        } else {
          // The phone, its body on top, and each caption recorded with the clip shown beside it while that part plays.
          await shot(cards.phoneFrame(s.step, s.role, s.title, s.where), bg);
          const bezel = path.join(WORK, `${s.id}-bezel.png`);
          await shot(cards.phoneBezel(), bezel, true);
          const cueFile = path.join(REC, `${s.file}.json`);
          const raw: { t: number; text: string }[] = existsSync(cueFile) ? JSON.parse(readFileSync(cueFile, "utf8")) : [];
          const cues = raw.map((c) => ({ start: Math.max(0, (c.t - skip) / speed), text: c.text }));
          const cuePngs: string[] = [];
          for (const [k, c] of cues.entries()) {
            const f = path.join(WORK, `${s.id}-cue${k}.png`);
            await shot(cards.cue(c.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")), f, true);
            cuePngs.push(f);
          }
          const graph = [clipChain(SCREEN.w, SCREEN.h), `[0:v][c]overlay=${SCREEN.x}:${SCREEN.y}:shortest=0[b0]`, `[b0][3:v]overlay=0:0[k0]`];
          cues.forEach((c, k) => {
            const end = k + 1 < cues.length ? cues[k + 1].start : len;
            graph.push(`[k${k}][${4 + k}:v]overlay=0:0:enable='between(t,${c.start.toFixed(2)},${end.toFixed(2)})'[k${k + 1}]`);
          });
          graph.push(`[k${cues.length}]format=yuv420p[v]`, voiceChain);
          ff(["-loop", "1", "-i", bg, "-ss", String(skip), "-i", fixed, "-i", wav, "-loop", "1", "-i", bezel,
            ...cuePngs.flatMap((f) => ["-loop", "1", "-i", f]),
            "-filter_complex", graph.join(";"), "-map", "[v]", "-map", "[a]", "-t", len.toFixed(3), ...ENC, out]);
        }
        parts.push({ file: out, len, say: s.say, transition: s.transition ?? "fade" });
      }
      console.log(`✓ ${s.id} (${parts.at(-1)!.len.toFixed(1)}s)`);
    }
  } finally {
    await browser.close();
  }

  // Join with cross-fades: each one overlaps the next part by FADE seconds, picture and sound together.
  const inputs = parts.flatMap((x) => ["-i", x.file]);
  const graph: string[] = [];
  let acc = parts[0].len, v = "0:v", a = "0:a";
  const starts = [0];
  for (let i = 1; i < parts.length; i++) {
    const offset = acc - FADE;
    starts.push(offset);
    graph.push(`[${v}][${i}:v]xfade=transition=${parts[i].transition}:duration=${FADE}:offset=${offset.toFixed(3)}[v${i}]`);
    graph.push(`[${a}][${i}:a]acrossfade=d=${FADE}[a${i}]`);
    v = `v${i}`; a = `a${i}`;
    acc += parts[i].len - FADE;
  }
  const film = path.join(REC, `${FILM}.mp4`);
  ff([...inputs, "-filter_complex", graph.join(";"), "-map", `[${v}]`, "-map", `[${a}]`, ...ENC, "-movflags", "+faststart", film]);

  // Subtitles: each scene's narration split into sentences, timed by length across the time the voice speaks.
  const ts = (t: number) => {
    const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  let n = 0;
  const srt: string[] = [];
  parts.forEach((x, i) => {
    const sentences = x.say.match(/[^.!?]+[.!?]+/g) ?? [x.say];
    const talk = duration(path.join(WORK, `${SCENES[i].id}.wav`));
    const total = sentences.reduce((s, t) => s + t.length, 0);
    let t = starts[i] + LEAD;
    for (const line of sentences) {
      const d = (line.length / total) * talk;
      srt.push(`${++n}\n${ts(t)} --> ${ts(t + d)}\n${line.trim().replace(/\b([A-Z]) (?=[A-Z]\b)/g, "$1")}\n`);
      t += d;
    }
  });
  writeFileSync(path.join(REC, `${FILM}.srt`), srt.join("\n"));
  console.log(`Film: ${film} (${duration(film).toFixed(0)}s)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
