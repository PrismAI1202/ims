# IMS – Scope review & role-based user flows

Nov 7, 2026 · @Udai Agarwal

## Summary

The app already covers all six SRS lifecycle stages and goes past the SRS with MRP, planning, maintenance and OEE. The main design problem is that every role gets the same tools, not that tools are missing. I reviewed the live app on ims-three-lemon.vercel.app on 7 Nov 2026, signed in as Admin and as each of the other four demo roles, and read the code in PrismAI1202/ims.

- **What works:** 27 working screens, 5 tabs, a scanner app that works offline, and a Process screen that already counts the open items each role "needs you" for.
- **Why users get lost:** all five roles land on the same Stock health home page. The More menu lists up to 24 modules, and Planning, Maintenance and Equivalents appear for every role, Dispatch Officer included. Tasks are spread across modules rather than collected in one inbox per role.
- **Biggest gaps:** returning material from the shop floor to stores, stock counts and adjustments, returning rejected lots to the supplier, customer returns, final and first-off inspection, PO approval, an audit trail and alerts. EDI and the e-way bill portal are still offline (the README lists both as known limits).
- **Recommendation:** make the existing Process "needs you" list each role's home page and cut each role's menu to 4 to 7 items. The flows below are built on that.
- **Role gaps:** there is no Planner or Purchase role, so MRP and demand fall on the Store Incharge, and Gate entry is not given to security staff.

## Scope map

The app has 27 working screens behind 5 tabs (Home, Process, Orders, Metrics, More) plus a separate Scanner. One link, /fg/labels, returns a 404.

| Stage | Screen | What it does | Who can act today |
| --- | --- | --- | --- |
| Set up | Admin · Masters | Items (Min/ROP/Max, safety stock, shelf life, max regrind %, HSN, COA flag), suppliers, customers, bins, machines, moulds; bin label print / ZPL | Admin |
| Set up | Users & roles | Create users, assign one of 5 roles, reset passwords, deactivate | Admin |
| Set up | Customers & suppliers | Partner list with segment, label format, GSTIN, open/past orders | View: all |
| Set up | BOMs | One BOM per FG: mould, part weight, resin/MB/regrind %, inserts and packaging per part | Admin |
| Set up | Equivalent materials | Approved alternate vendor grades per spec; single-source warning | Admin, Store, QA |
| Demand | Customer demand | Upload forecast / firm / spot schedule (CSV, Excel); export | Admin, Store |
| Buy | MRP plan | Net demand vs stock and open POs, BOM explosion, Kanban vs ROP policy, suggested POs | Admin, Store |
| Buy | Supplier PO | Multi-line PO, segment, edit, cancel, close short | Admin, Store |
| Receive | Gate entry & GRN | Receive against PO: vehicle, invoice, heat/lot no., bags, weight, COA upload; creates lots as Pending QC | Admin, Store |
| Receive | Inward QC | MFI, moisture, density, tensile; approve, deviate or reject; put-away bin | Admin, QA |
| Store | Stores | Stock by item with colour status, bin map, bin transfer | View: all; transfer: Admin, Store |
| Store | Material requests | Requisition by item, qty, machine | Admin, Production |
| Store | FIFO issue | Issue against a request in FIFO/FEFO order; an override needs a reason | Admin, Store |
| Store | Scanner (PWA) | Issue, bin transfer, dispatch loading; offline queue | All, by permission |
| Make | Planning | Mould × machine weekly board; block for PM or a trial | Edit: Admin, Store, Production |
| Make | Production | Shift booking: shots, good, rejects, runner kg (scale input), material lots used; downtime log | Admin, Production |
| Make | Scrap approval | Regrind or waste decision per booking's rejects | Admin, QA |
| Make | Maintenance | Mould shot life, PM due, repairs, MTBF / MTTR | Edit: Admin, Production |
| Pack | FG & box labels | Box FG lots per customer format (OEM / generic), print labels | Admin, Production, Dispatch |
| Ship | Dispatch | Pick list, scan boxes, DC + packing list, e-way JSON | Admin, Dispatch |
| Ship | Returnable ledger | Crate issue/return balance per customer, opening balance | Admin, Dispatch |
| Report | Home (Stock health) | Red / yellow / green tiles for every item | All |
| Report | Process | 11-step live process with "needs you" counts per role, auto / non-auto | All |
| Report | Orders | All buy and sell documents with status filters | All |
| Report | Metrics | OEE by day/machine/shift, downtime reasons, QC rejects, regrind %, MTBF/MTTR, PM compliance | All |
| Report | Traceability | Back trace from a box / lot, forward recall from a heat no. | All |
| Report | BOM variance | BOM-expected vs issued material, export | All except Dispatch |
| Device | Account, Sync centre | Change password; offline outbox | All |

## Industry process flow

The user flows follow the standard moulding-plant sequence from the SRS lifecycle, with the three QA gates that IATF 16949 plants use (inward, first-off, final).

&#91;embedded content: industry process flow · 5 roles, 17 steps\]

There are 11 handovers between roles. Each should become a task in the receiving role's inbox, not a module they have to go and look in.

## User flows by role

Each flow follows the plant's shift routine, not the app's current menus. Steps marked *(new)* are not built yet. The "Home" line is the screen each role should land on.

### Admin (plant head / system owner)

Home: plant overview of exceptions, OEE and stock alerts, with Process as the drill-down.

1. **Go-live set-up (once, then as things change):** users and roles, then items with Min/ROP/Max, then suppliers and customers with segment and label format, then bins and labels, then machines and moulds, then BOMs and equivalent grades.
2. **Daily review:** exceptions queue, covering FIFO overrides, QC deviations, POs waiting for approval *(new)*, stock adjustments waiting for approval *(new)* and overdue PM.
3. **Approvals:** release POs above a value limit *(new)*, approve stock count adjustments *(new)*, sign off deviations with QA.
4. **Weekly:** check Metrics (OEE, downtime Pareto, rejects, regrind %) and BOM variance, and act on the outliers.
5. **Month-end:** stock valuation, physical count reconciliation *(new)*, returnable balances, audit log review *(new)*.

### Store Incharge

Home: today's task inbox (trucks to receive, lots to put away, requests to issue) above the stock alerts.

1. **Plan the buy (morning):** check red and yellow items, then the MRP plan, then raise or release POs.
2. **Receive (when a truck arrives):** gate entry (vehicle, invoice), then GRN against the PO (heat/lot no., bags, weight, COA upload for automotive), then print the lot tag. The lot moves to staging as Pending QC and QA is notified *(new)*.
3. **Put away (after QC):** QC-approved lots appear as put-away tasks. Scan the lot, then scan the bin.
4. **Issue to the floor (all shift):** open requisitions arrive in the inbox. The system shows the FIFO/FEFO lot. Scan the lot and bin, then the quantity, then issue to the machine.
5. **Take back (end of shift):** unused material returns from the machine to a bin *(new)*. Rejected lots go back to the supplier with a debit note *(new)*.
6. **Housekeeping:** bin transfers, a cycle count of a few bins a day *(new)*, and returnable crates received at the gate.

### QA Inspector

Home: QC queue with three tabs, Inward, In-process and Final, plus the scrap waiting for a decision.

1. **Inward:** take a lot from the queue, verify the COA against the PO and spec (mandatory for automotive), enter MFI, moisture, density and tensile, then decide. Approve releases the lot and prints its tag, Deviate needs remarks and approval, Reject sends it to return-to-vendor *(new)*.
2. **First-off approval (each mould set-up and shift start):** the Production Lead requests a first-off. QA checks the sample and approves before booking can begin *(new)*.
3. **Patrol and in-process checks (every 2 to 4 hours):** dimensional and visual checks per machine are logged *(new)*.
4. **Scrap decision:** rejects from bookings are crushed into regrind (only when the part has no inserts) or scrapped as waste. This needs bulk actions; the demo shows 558 waiting.
5. **Final inspection (PDI) before dispatch:** sample FG boxes and release the FG lot, or put it on hold *(new)*.
6. **Investigate:** use traceability for recalls and complaints, log customer complaints and 8D actions *(new)*, approve equivalent grades.

### Production Lead

Home: "My machines this shift", each machine card showing the mould, the plan, material at the machine, the last booking and open downtime.

1. **Shift start:** see the plan per machine, confirm the mould is loaded, and raise material requests. Requests should be pre-filled from the plan and the BOM *(new)*.
2. **Receive material at the machine:** scan the lot tags of resin, masterbatch and regrind fed into the hopper. Drying and pre-conditioning are logged for hygroscopic resins such as PA66 and PC *(new)*.
3. **Request a first-off from QA *(new)*, then start the run.**
4. **Hourly:** book shots, good parts and rejects. Log every stop with a reason code (mould change, breakdown, no material and so on).
5. **End of shift:** weigh the runner and sprue (scale), close the booking, send rejects to scrap approval, return unused material *(new)*.
6. **Pack:** box the FG lot per customer format, print the labels, hand over to the FG store.
7. **Maintenance:** raise repair tickets and confirm PM checklists when the shot count is due.

### Dispatch Officer

Home: today's shipments (due from the firm schedule) with FG availability per part.

1. **Plan:** due lines come from customer firm schedules and spot orders. Today the pick list is built by hand, so this needs a link to demand *(new)*.
2. **Pick:** create the pick list, then pick boxes in FIFO order. Only PDI-released boxes can be picked *(new)*.
3. **Load:** scan each box onto the vehicle (the scanner works offline). Wrong part, wrong customer or a duplicate scan is blocked.
4. **Documents:** DC and packing list, tax invoice *(new)*, e-way bill data (JSON today, the portal API later), and an ASN to the OEM where required *(new)*.
5. **Returnables:** crates going out are added to the dispatch automatically. Returns are recorded when the customer's vehicle brings them back.
6. **Exceptions:** customer returns or rejections come back in and go to QA hold *(new)*.

## Streamlining the design

The fastest fix is to make the home page a task inbox and give each role a short menu. The data behind both already exists in the Process screen.

1. **A home page per role.** Reuse the Process screen's "needs you" logic as a task inbox at the top of Home. Show stock health only to Admin and Store.
2. **Menus trimmed per role.** Hide view-only modules that don't help the role. Today Dispatch sees Planning, Maintenance and Equivalents, and QA sees Planning. Proposed menus:

| Role | Menu items (in order) |
| --- | --- |
| Admin | Overview, Process, Masters, Users, BOMs, Approvals, Metrics, Reports |
| Store Incharge | Inbox, Receive (Gate + GRN), Put-away, Issue, Stock & bins, Buy (MRP + PO), Count |
| QA Inspector | QC queue (Inward / In-process / Final), Scrap, Trace, Equivalents |
| Production Lead | My machines, Book, Downtime, Requests, Pack & label, Maintenance |
| Dispatch Officer | Today's shipments, Pick & load, Documents, Returnables, FG stock |

3. **Chain the tasks.** Each step should create the next person's task. A GRN creates a QC task, QC approval creates a put-away task, a request creates an issue task, and a shift's rejects create a scrap task. People then follow the inbox instead of looking through modules.
4. **Scan first on mobile.** Put one "scan anything" button in the tab bar. It reads the tag (lot, bin, box, PO) and offers only the actions the role can take. The Scanner is a separate app today, outside the main tabs.
5. **Merge screens that overlap.** Combine Gate entry and GRN into one guided receive flow, and Requests and FIFO issue into one requisition inbox. Fold Orders into Partners, and keep Process and Metrics for Admin.
6. **Make long queues workable.** Scrap approval shows 558 bookings as one long page, so it needs filters and bulk decisions. The other queues need sorting by age.
7. **Fix the broken link:** /fg/labels returns a 404.

## Missing functionality

Nothing in the SRS is entirely missing. EDI and the live e-way bill portal are partly built: CSV/Excel import and a JSON e-way file stand in for now. The bigger gaps are the reverse flows and controls that plants rely on day to day. I checked each one in the code (schema, services and screens), not just the UI.

| Priority | Gap | Why it matters | Source |
| --- | --- | --- | --- |
| P1 | Return unused material from the machine to stores | Variance shows material left at the machine as over-use, and stock is understated | Industry; the README lists the variance issue |
| P1 | Stock count and adjustment, with approval | No way to fix a balance after a physical count (an ADJUST ledger type exists but is unused) | Industry |
| P1 | Return rejected lots to the supplier, with a debit note | Rejected lots sit in staging with no exit | Industry |
| P1 | Final inspection (PDI) and FG lot release before dispatch | IATF plants need a QA release before shipping | IATF / industry |
| P1 | First-off approval at mould set-up | Stops a shift of bad parts; also an IATF need | IATF / industry |
| P1 | Task notifications (in app, then WhatsApp or email) | Without them every handover depends on people checking screens | Industry |
| P2 | Customer returns and rejections to QA hold, then rework or scrap | Closes the loop on complaints | Industry |
| P2 | Pick lists created from firm schedules and orders | Today they're built by hand, with no link to demand | SRS Module 1/5 intent |
| P2 | PO approval by value and role | POs go live with no approval | Industry |
| P2 | Audit log of who changed what | Masters, BOM and permissions changes aren't tracked | IATF / industry |
| P2 | Tax invoice, and an ASN for OEMs | The DC exists, but a GST invoice is needed to ship | Industry |
| P2 | Planner / Purchase role and a Security (gate) role | MRP and gate entry are currently put on the Store Incharge | SRS gap |
| P3 | EDI import and the live e-way bill portal API | Already listed as known limits | SRS §4 / README |
| P3 | Resin drying log, in-process patrol checks, complaint / 8D log | Common in automotive moulding audits | Industry |
| P3 | Labels for WIP and regrind bags, and a material hold at the machine | Trace through regrind is chained, but bags aren't labelled | Industry |
