# IMS – Injection Moulding Inventory Management

Inventory system for an injection moulding plant, built from the SRS "Custom Inventory Management System – Injection Moulding Unit". Handles automotive (strict lot traceability, COA before GRN) and non-automotive customers.

**Built so far (Phase 1):** masters (read-only lists), purchase orders, gate entry & GRN with COA rule, QC hold/release with put-away and printable QR lot tags, stock by bin with Min/ROP/Max colour dashboard, bin transfers, material requests, FIFO/FEFO-enforced issue to shop floor, and a mobile scanner PWA with an offline queue.
**Planned:** moulding BOM & regrind, production booking, FG labels & dispatch, MRP, full traceability. See "Roadmap".

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind · Prisma · PostgreSQL · Auth.js · Vitest

## Getting started
Requires Node 20+ and Docker.

```bash
npm install
cp .env.example .env        # then set AUTH_SECRET:  openssl rand -base64 32
npm run db:up               # Postgres 16 in Docker (port 5433)
npm run db:migrate
npm run db:seed             # sample items, bins, and one user per role (see prisma/seed.ts)
npm run dev
```

Open http://localhost:3000 and sign in with a seeded account (emails and the dev-only password are in `prisma/seed.ts`; change them for any real deployment).

## Scripts
| Command | What it does |
|---|---|
| `npm test` | Unit tests plus integration tests (integration tests need a database named `ims_test`, see below) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run token:create -- <email> [label]` | Issues a Bearer token for a scanner device / native app |

Integration tests run against a separate database so dev data is never touched:
```bash
docker exec ims-postgres createdb -U ims ims_test
DATABASE_URL="postgresql://ims:ims@localhost:5433/ims_test?schema=public" npx prisma migrate deploy
```

## Architecture notes
- Business rules live in `src/server/services/` (no React/Next imports). Pages call them via server actions; the scanner uses the same services through `/api/v1/*`.
- Every stock change is written to the append-only `StockTransaction` ledger; balances are updated in the same database transaction.
- Offline scans carry a client UUID and sync through `/api/v1/sync`, which is idempotent, so replays are safe.
- Roles and permissions: `src/server/auth/permissions.ts` (SRS §5). Pages and actions each check their own permission.
- The API accepts the session cookie or a Bearer token, so a native mobile app can be added later without changing the backend.

## Roadmap
1. Masters create/edit forms
2. Moulding BOM, production booking, runner/regrind tracking, BOM-vs-actual variance
3. FG labels (OEM/generic), pick-list scan, delivery challan / e-way bill data, returnable container ledger
4. Demand import (Excel/CSV/EDI) and MRP
5. Full traceability drill-down, report exports, scale/ZPL integration, cloud deployment
