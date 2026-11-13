# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

Inventory system for an injection moulding plant, built from the SRS PDF in the parent folder (`../Software Requirement Specification - Injection Moulding Inventory Management.pdf`). Code comments cite it as "SRS §N" / "SRS Module N". Two customer segments drive the rules: AUTOMOTIVE (strict lot traceability, COA mandatory before GRN) and NON_AUTOMOTIVE. Phase 1 is built; the roadmap (BOM/regrind, production booking, FG labels and dispatch, MRP, traceability) is in README.md.

Stack: Next.js 16.4 (App Router, `cacheComponents: true`), React 19, TypeScript, Tailwind 4, Prisma 6 + PostgreSQL 16, Auth.js v5 (credentials + JWT), Zod 4, Vitest 5.

## Commands

```bash
npm run db:up            # Postgres in Docker, container "ims-postgres", host port 5433 (not 5432)
npm run db:migrate       # prisma migrate dev
npm run db:seed          # tsx prisma/seed.ts: items, bins, one user per role
npm run db:seed:demo     # tsx prisma/seed-demo.ts: design-mock-up examples (lots, BOMs, production, dispatch); run after db:seed
npm run dev
npm run lint
npm run typecheck        # tsc --noEmit
npm test                 # vitest run: unit + integration
npx vitest run src/server/services/domain.test.ts      # one file
npx vitest run -t "is RED below min"                    # one test by name
npm run token:create -- <email> [label]                 # Bearer token for a scanner device
```

Integration tests (`*.int.test.ts`) need a separate `ims_test` database. They truncate tables and assert that the URL contains `ims_test`. Override it with `TEST_DATABASE_URL`. One-time setup:

```bash
docker exec ims-postgres createdb -U ims ims_test
DATABASE_URL="postgresql://ims:ims@localhost:5433/ims_test?schema=public" npx prisma migrate deploy
```

Run that `migrate deploy` against `ims_test` again after adding a migration. Vitest runs files serially (`fileParallelism: false`) because the integration tests share one database.

## Architecture

**Layering.** Business rules live in `src/server/services/`, which has no React or Next imports. The two callers share those services:
- Web pages under `src/app/(app)/*` are server components with inline `"use server"` actions.
- The scanner PWA under `src/app/(scan)/scan/*` calls `/api/v1/*` route handlers.

Service functions take an optional trailing `db: PrismaClient` argument (defaulting to the shared client). Integration tests use it to pass a client pointed at `ims_test`.

**Errors and action flow.** Services throw `DomainError` for rule violations. Server actions wrap the service call in `runAction(path, okMessage, fn)` from `src/server/auth/guard.ts`. On success it redirects to `path?ok=...`. On a `DomainError` it redirects to `path?error=...`, and the page shows that message with `<Flash>`. Any other error is re-thrown. API routes turn a `DomainError` into a per-op error message.

**Auth and permissions.** Roles are rows in `AccessRole` (key, name, `views[]`, `permissions[]`, `allAccess`), and `User.role` is the role key. Admins edit them under Settings · Roles & access (`/settings`, `services/roles.ts`). The migration and `SYSTEM_ROLES` in `src/server/auth/permissions.ts` define the built-in roles (the SRS §5 five, plus PLANNER and a full-access DEMO). `src/lib/views.ts` is the screen catalog: each view has an href, an optional `requires` permission that the view grants automatically, and optional extra `actions`. `resolveAccess()` turns a role into `{ views, permissions }`, and the session carries that result, refreshed on every read. Check with `can(user, perm)` and `canView(user, view)`.
- Pages call `requireView(view)`. Server actions call `requirePermission(...)` themselves, because the `(app)` layout's auth check does not cover them. Home, Account and Sync use `requireUser()`.
- API routes use `getApiUser(req)`, which accepts either the session cookie or an `Authorization: Bearer ims_...` token. Only the SHA-256 hash of a token is stored, in `ApiToken`.
- The sidebar, the More page and the phone tab bar (Home, the role's first three views in stored order, More) are built from the user's views. Home shows the role's task inbox from `services/inbox.ts`; each task belongs to the view where the work is done.
- **Merged screens (Nov 2026).** Users live on the People tab of Settings (`/settings?tab=people`); Sync centre is a panel on Account; Customers & suppliers (`/partners`) is edited in place with `partners.manage` (Masters now has only Items and Machines); Supplier PO and Dispatch are part of **Orders** (`/orders`), a filterable, paginated list (`orders.ts`: `filterOrders`, `paginate`) where raising POs and pick lists are the separate `po.manage` and `dispatch.manage` actions. The PO and dispatch detail pages (`/purchase/[id]`, `/dispatch/[id]`) remain. Order forms use `components/order-lines.tsx` (`LinesEditor`: numbered rows with +/- and totals; rows post as repeated `itemId`/`qty`/`price`/`date` fields, read with `readLines` in `server/line-form.ts`). Orders raised elsewhere come in through "Import from file": `po-import.ts` (all-or-nothing, groups rows by supplier and `po_ref`, skips a PO whose `PurchaseOrder.externalRef` is already loaded for that supplier) and the existing demand importer for customer orders. `createPurchaseOrderIn(tx, …)` lets a batch of POs share one transaction. The BOM editor is a side panel (`components/side-panel.tsx`, opened by `/bom?new=1`, `?edit=<id>` or `?import=1`) around `components/bom-form.tsx`: colour-coded material cards that post repeated `itemId`/`value` fields, with the blend rules checked live by reusing `validateBomLines` from `bom-math.ts` (keep that file free of server imports). New parts and materials can be added from inside the editor (`new-item-card.tsx` → `POST /api/v1/items` → `createItemWithSupplier`, which also writes the `PriceMaster` row), and BOMs can be imported from a file (`bom-import.ts`, all-or-nothing, optionally creating missing items; `saveBomIn(tx, …)` and `createItemIn(tx, …)` let an import run in one transaction). **A supplier price (`PriceMaster`) is what lets MRP and "Raise PO" order an item**; items get one at creation or on the item page ("Suppliers & prices"). Old addresses redirect in `next.config.ts`. `removeSupplier`/`removeCustomer` delete what was never used and deactivate what has history. Shared edit-mode UI is in `components/edit-mode.tsx`. Machines and moulds are edited on the Maintenance screen (`equipment.manage`; Masters has only Items): `removeMachine`/`removeMould` delete what was never used and retire (`active = false`) what has history, so every machine/mould picker and write path must filter or check `active`.
- **Quality hub (Nov 2026).** Inward QC, Scrap, Final inspection (PDI), First-off and Return to supplier are tabs of one `quality` view (`/quality?tab=…`; bodies in `app/(app)/quality/tabs/`, actions in `quality/actions.ts`). A view with `tabs` in `views.ts` is a hub: each tab is its own permission (`qc.inspect`, `scrap.approve`, `pdi.release`, `firstoff.request`/`firstoff.approve`, `rtv.manage`), `hubTabs()` lists what a user may open, and `resolveAccess` drops the hub when none is held. `roles.ts` `needTabs` refuses saving a role with the hub ticked and no tab. Settings shows it with `components/hub-access-row.tsx` and each role card lists its Quality tabs. Push, inbox and Home use `{ view: "quality", perm }` with `qualityHref(tab)`; old `/qc`, `/qc/scrap`, `/pdi`, `/firstoff`, `/rtv` redirect in `next.config.ts`. Every tab action re-checks its own permission.
- To add a screen: add it to `VIEWS`, guard the page with `requireView`, and tick it for the roles that need it (new migration or Settings).

**Next 16 specifics.** Because `cacheComponents` is enabled, anything that reads the session first calls `await connection()` so Next does not prerender it (`requirePermission` already does this). Pages export `export const instant = false`. Before using an unfamiliar Next API, check `node_modules/next/dist/docs/` (see AGENTS.md).

**Stock model** (see `prisma/schema.prisma` and `src/server/services/inventory.ts`):
- **Ledger.** `StockTransaction` is an append-only ledger with signed `qty`. Every movement writes ledger rows and updates `StockBalance` (one row per lot and location) in the same `db.$transaction`. Never change a balance without writing a ledger entry.
- **Receiving.** GRN creates one `Lot` per received line with status `PENDING_QC`, places it in the single `STAGING` location, and moves the PO to PARTIAL or CLOSED.
- **QC.** `recordQc` sets the lot to APPROVED, REJECTED or DEVIATED (a deviation requires remarks). An approved lot can be put away into a `STORAGE` bin.
- **Usable stock.** Only APPROVED and DEVIATED lots count as on-hand (`stock.ts`). PENDING_QC is reported separately and REJECTED is excluded. Dashboard colours come from `stock-status.ts`: RED below Min, YELLOW up to and including ROP, GREEN above.
- **Picking order.** Issue enforces FEFO when lots have an expiry date and FIFO by receipt date otherwise (`fifo.ts`, pure functions). Issuing out of order requires `fifoOverrideReason`.
- **Document numbers.** `nextNumber()` builds them as `PREFIX-YYMMDD-NNNN` from a table count.
- **Decimals.** Quantities are Prisma `Decimal`. Convert them with `Number(...)` before doing arithmetic.

**Offline scanning.** `src/lib/offline-queue.ts` keeps queued TRANSFER and ISSUE ops in IndexedDB (`idb`). Each op is keyed by a client UUID and is flushed to `POST /api/v1/sync`. The services are idempotent on `clientUuid`:
- `transferStock` checks `StockTransaction.clientUuid` using the suffixes `:out` and `:in`.
- `issueStock` checks `IssueLine.clientUuid`.

Replaying the whole queue is therefore safe, and replayed ops come back as `"replayed"`. Ops the server rejects stay in the queue with the server's message so the operator can discard them. Server and network errors leave ops queued for retry. To add a new offline op type, update the Zod union in `sync/route.ts`, the `QueuedOp` type, and give the service function a `clientUuid` idempotency check. The unit test for the queue uses `fake-indexeddb`.

## Home, task flow and push

- **Home widgets.** `AccessRole.home` lists widget keys in order (catalog: `src/lib/home-widgets.ts`; components: `src/components/home/`, registry in `index.tsx`). `resolveAccess` drops a widget the role has no view or permission for and falls back to `needs-you`. Admins edit the list under Settings · Roles & access. Data for the role-specific widgets is in `services/home.ts`; the task inbox is `services/inbox.ts` (each task belongs to the view where it is done).
- **Plant rules** (`AppSetting`, `getRule`/`setRule` in `settings.ts`): `requirePdi` (default on) and `requireFirstOff` (default off). `bookProduction` creates FG lots with `pdiStatus` PENDING when PDI is required, and `scanBox` refuses PENDING/HOLD lots. Fixtures that book and then dispatch must set the lot to RELEASED.
- **Stock count** (`stockcount.ts`): start, save, submit, then an approver's `decideCount` writes ADJUST ledger rows. **Return to stores** (`returns.ts`) writes RETURN rows (`refType` MACHINE_RETURN) capped by issued less used less returned, and the variance report nets them. **Return to supplier** (`rtv.ts`) writes RTV_OUT rows and a `ReturnToVendor` debit note. **First-off** (`firstoff.ts`): an approval holds 24 hours per machine, part and shift.
- **Store layout.** Bins are edited on the Stores bin map in "Edit layout" mode (`bins.manage`; there is no Masters Bins tab). `masters.ts`: `addBin`, `removeBin`/`removeRack` (a never-used bin is deleted; one with history gets `Location.active = false`, so the ledger keeps its reference; adding the same code again reactivates it), and `renameBin`/`renameShelf`/`renameRack` (rebuild `code` = RACK-SHELF-BIN; stock stays put). Every picker and destination lookup filters `active: true`; new code that lists or looks up bins must do the same. Stores access is a ladder on the view (`levels` in `views.ts`: View, Move stock, Edit layout, each including the one below), shown as one toggle in Settings.
- **Push** (`notify.ts`, Web Push via `web-push`, keys in `VAPID_*`). `notifyView({ view, perm?, exceptUserId? }, payload)` tells active users whose role has the view; it never throws and deletes subscriptions that answer 404/410. Services stay free of Next imports, so server actions call `pushAfter()` from `src/server/push.ts` (wraps `after()`) once the work succeeded. Subscriptions are saved through `/api/v1/push` by `components/push-toggle.tsx` on the Account page, and `public/sw.js` shows and opens them.

## Phase 6: equivalents, maintenance, planning, downtime, OEE

- **Tables** (one additive migration): `EquivalentGroup/Grade`, `Downtime`, `PmRecord`, `RepairTicket`, `PlanSlot`, `AppSetting`, plus cycle time / min tonnage / PM fields on `Mould`.
- **Services** (`src/server/services/`): `equivalents.ts`, `maintenance.ts`, `planning.ts`, `downtime.ts`, `settings.ts`, `metrics.ts`, `process.ts`, and the pure maths in `oee.ts`. Grade stock is derived from lots received on a PO from the grade's supplier; mould shots = go-live counter + shots booked in production.
- **OEE** = Availability × Performance × Quality. Planned time is `shiftMinutes` (AppSetting, default 480) per machine-shift that ran or stopped; performance needs `Mould.idealCycleSec`, and a bucket without it shows "—" instead of an invented number.
- **Process** is a live read-only view built from real GRNs, QC, issues, production and dispatches; the stage list is fixed in `process.ts`.
- New permissions: `equivalents.manage`, `plan.manage`, `maintenance.manage`, `downtime.log` (grade approval uses `qc.inspect`).

## Conventions

- Imports use the `@/` alias for `src/`. It is also configured in `vitest.config.mts`.
- Unit tests sit next to the code as `*.test.ts`. Tests that need the database are named `*.int.test.ts`.
- `.env` is git-ignored; `.env.example` is tracked. Set `AUTH_SECRET` with `openssl rand -base64 32`.
