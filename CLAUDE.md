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

**Auth and permissions.** `src/server/auth/permissions.ts` holds the SRS §5 role → permission matrix (`can`, `assertCan`). Every page and every server action calls `requirePermission(...)` itself, because the `(app)` layout's auth check does not cover server actions. API routes use `getApiUser(req)`, which accepts either the session cookie or an `Authorization: Bearer ims_...` token. Only the SHA-256 hash of a token is stored, in `ApiToken`. Sidebar nav items are filtered by the same permissions.

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

## Conventions

- Imports use the `@/` alias for `src/`. It is also configured in `vitest.config.mts`.
- Unit tests sit next to the code as `*.test.ts`. Tests that need the database are named `*.int.test.ts`.
- `.env` is git-ignored; `.env.example` is tracked. Set `AUTH_SECRET` with `openssl rand -base64 32`.
