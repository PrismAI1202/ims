# IMS HTTP API (v1)

This is the API the scanner PWA already uses, and what a native mobile app (for example React Native / Expo) would call.
**No native app exists yet**; this document is the contract it would be built against.

Base path: `/api/v1`. All bodies are JSON unless stated.

## Authentication

Two ways, both resolved by the same code (`src/server/auth/api-auth.ts`):

- **Browser session cookie**: what the web app and PWA use after signing in.
- **Bearer token**: for devices and native apps.
  ```
  Authorization: Bearer ims_<48 hex characters>
  ```
  Issue one on the server: `npm run token:create -- user@plant.com "Dock scanner 1"` (the plain token is printed once; only its
  hash is stored). Tokens act as that user, with that user's role. Deactivating the user, or resetting their password,
  revokes their tokens.

Errors look like `{ "error": "message" }` with status `401` (no or invalid credentials), `403` (role not allowed), `400`
(bad input), `404`. Permissions follow the role matrix in `src/server/auth/permissions.ts`.

## Endpoints

| Method & path | Needs | Purpose |
|---|---|---|
| `POST /sync` | role-dependent per op | Apply queued scanner operations (below). |
| `GET /open-lines` | `stock.issue` | Open material request lines with FIFO/FEFO-ordered lots, for the issue screen. |
| `GET /open-dispatches` | `dispatch.manage` | Dispatches being loaded, with pick-list progress. |
| `GET /barcode?type=qr\|code128&text=…` | signed in | PNG barcode image. |
| `GET /zpl?boxes=…` / `?lot=…` / `?bins=…` | `fg.pack` / `stock.view` / `masters.manage` | ZPL label job as a text file. |
| `GET /export/{stock\|variance\|returnables\|mrp\|demand}?format=xlsx\|csv` | per report | Report download. `variance` takes `from`/`to` (YYYY-MM-DD); `mrp` takes `horizon` (days) and `scrap` (%). |
| `GET /files/{name}` | `stock.view` | An uploaded COA certificate. |
| `GET /dispatch/{id}/eway` | `dispatch.manage` | E-way bill (delivery challan) data as a JSON file. |
| `GET /demand-template` | `mrp.plan` | CSV template for demand upload. |
| `GET /health` | none | `{ "ok": true }`, or 503 if the database is unreachable. |

## `POST /sync`: offline-safe operations

Body: `{ "ops": [ … up to 200 … ] }`. Each op has a client-generated **`clientUuid`** (8–100 chars; a UUID is ideal).

```jsonc
{ "type": "TRANSFER", "clientUuid": "…", "lotNumber": "LOT-…", "fromCode": "A-01-01", "toCode": "A-01-02", "qty": 100 }
{ "type": "ISSUE", "clientUuid": "…", "requestLineId": "…", "lotNumber": "LOT-…", "locationCode": "A-01-01", "qty": 50, "fifoOverrideReason": "optional" }
{ "type": "DISPATCH_SCAN", "clientUuid": "…", "dispatchId": "…", "scan": "BX-… or the full OEM label record" }
```

Response: `{ "results": [{ "clientUuid": "…", "status": "ok" | "replayed" | "error", "message"?: "…" }] }`, in the same order.

How to use it from a client that can lose connectivity:

1. Save each scan locally with a fresh `clientUuid`, then try to send. Mark it done only when its result is `ok` or `replayed`.
2. **Resending is always safe.** Sending the same `clientUuid` again returns `replayed` and changes nothing, so if a response
   is lost, resend the whole queue.
3. `error` means the server understood the operation and **rejected it** (unknown lot, FIFO violation, wrong customer's
   box, not permitted…). Keep it visible to the operator with `message`; do not retry it automatically. A message starting
   with "Server error" is transient: retry later.
4. Operations in one request are applied in order and independently: a failure does not stop the ones after it.

Reference implementation: `src/lib/offline-queue.ts` (IndexedDB queue, flush, rejected-item handling).

## Caching for offline use

`GET /open-lines` and `GET /open-dispatches` return a `fetchedAt` timestamp. The PWA caches the last response so the screens
still work offline, and tells the user how old the data is. A native app should do the same.

## Notes for a native app

- Use the Bearer token path; keep the token in the platform keystore (Keychain / Keystore), never in plain storage.
- Scanning: camera barcode libraries return the QR text; handheld scanners (Zebra DataWedge) can send keystrokes or intents.
  OEM box labels encode `PART|BATCH|SHIFT|MACHINE|QTY|YYYYMMDD|BOXCODE`; the server reads the last field, so send the whole scan.
- Business rules live on the server (`src/server/services`), so a native client needs no copies of them.
- The Zod schemas that validate input are in `src/lib/schemas` and the sync route; reuse or mirror them for client-side checks.
