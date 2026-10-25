# IMS – Injection Moulding Inventory Management

Inventory system for an injection moulding plant, built from the SRS "Custom Inventory Management System – Injection Moulding Unit".
It handles automotive customers (strict lot traceability, COA before GRN, Kanban buffers) and non-automotive customers (reorder points).

## What it does

| Area | Features |
|---|---|
| **Masters** | Items (Min/ROP/Max, COA flag, HSN, price), suppliers, customers (segment, label format, GSTIN), bins, machines, moulds. Create/edit, deactivate instead of delete. |
| **Demand & MRP** | Upload forecasts / firm schedules / spot orders (Excel or CSV). MRP nets demand against stock and open POs, explodes through BOMs, applies Kanban (automotive) or reorder-point rules, and creates purchase orders from the plan. |
| **Purchasing & inward** | Multi-line POs (edit, cancel, close short), gate entry & GRN, COA upload (mandatory for automotive), QC hold/release with lab values and put-away, printable QR lot tags. |
| **Stock** | Stock by bin and lot, Min/ROP/Max colour dashboard, bin transfers, material requests, FIFO/FEFO-enforced issue. |
| **Production** | Moulding BOM (blend must total 100%, max regrind enforced), production booking with the material lots used, runner → regrind stock, QA scrap approval (regrind or waste), BOM-vs-issued variance. |
| **Finished goods & dispatch** | FG lots from production, customer-format box labels (OEM/generic), pick-list dispatch with scan validation, delivery challan + packing list, e-way bill data, returnable container ledger (with optional crate stock tracking). |
| **Traceability** | Box → machine/shift/mould → resin heat lot → supplier GRN/COA/QC, and recall search from a heat number to every customer reached (regrind chained). |
| **Scanner PWA** | Mobile screens for issue, bin transfer and dispatch loading with an offline queue that syncs safely. |
| **Reports** | Excel/CSV export of stock, variance, returnables, MRP plan and demand; print-to-PDF from the browser. |
| **Hardware** | ZPL output for Zebra-compatible printers (download or send to a network printer); weighing-scale input via Web Serial. |
| **Admin** | Users and roles (five roles per SRS §5), password reset/change, sessions re-checked on every request so deactivation takes effect immediately. |

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind · Prisma · PostgreSQL · Auth.js · Vitest

## Getting started (development)
Requires Node 20+ and Docker.

```bash
npm install
cp .env.example .env        # then set AUTH_SECRET:  openssl rand -base64 32
npm run db:up               # Postgres 16 in Docker (port 5433)
npm run db:migrate
npm run db:seed             # DEMO data and demo logins (see prisma/seed.ts). Never run this in production.
npm run db:seed:demo        # optional: richer DEMO data matching the design mock-ups (stock in bins, BOMs, production, dispatch). Run after db:seed; never in production.
npm run dev
```

Open http://localhost:3000 and sign in with a seeded demo account (emails and the dev-only password are in `prisma/seed.ts`).

## Scripts
| Command | What it does |
|---|---|
| `npm test` | Unit + integration tests (integration tests need a database named `ims_test`, see below) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run admin:create -- <email> "<name>"` | Create an admin (password from `ADMIN_PASSWORD`). Use this instead of the seed in production. |
| `npm run token:create -- <email> [label]` | Issue a Bearer token for a scanner device / native app |

Integration tests run against a separate database that they truncate, so dev data is never touched:
```bash
docker exec ims-postgres createdb -U ims ims_test
DATABASE_URL="postgresql://ims:ims@localhost:5433/ims_test?schema=public" npx prisma migrate deploy
```

## Documentation
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): Docker, AWS/Azure checklists, go-live checklist, what only real hardware can confirm.
- [`docs/API.md`](docs/API.md): the HTTP API the scanner uses and a native app would call.

## Architecture notes
- Business rules live in `src/server/services/` (no React/Next imports). Pages call them via server actions; the scanner uses the same services through `/api/v1/*`.
- Every stock change is written to the append-only `StockTransaction` ledger; balances update in the same database transaction.
- Offline scans carry a client UUID and sync through `/api/v1/sync`, which is idempotent, so replays are safe.
- Roles and permissions: `src/server/auth/permissions.ts`. Every page and action checks its own permission.
- File uploads (COA) live under `UPLOAD_DIR`, outside the web root, served only to signed-in users after the file's real type is verified.

## Known limits
- EDI parsing is not built (schedules come from Excel/CSV); EDI needs each customer's message spec.
- E-way bill data is produced as a JSON file; it is not sent to the government portal.
- Variance compares issued material with BOM-expected use, so material still sitting at machines shows as variance.
- Hardware paths (handheld/camera scanning, weighing scale, ZPL printer) are unit-tested but untested on physical devices.
- No native mobile app yet; the PWA covers scanning.
