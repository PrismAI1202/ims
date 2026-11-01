# Deploying to Vercel

The app runs on Vercel with a hosted Postgres and a private Vercel Blob store. `vercel.json` pins the functions to Mumbai (`bom1`), and `npm run vercel-build` (see `scripts/vercel-build.sh`) generates the Prisma client, applies migrations on production deploys, then builds.

## One-time setup

1. **Import the repo** at vercel.com/new (GitHub `PrismAI1202/ims`). Leave the framework as Next.js. The build command comes from the `vercel-build` script.
2. **Add a Postgres database.** Project → Storage → Marketplace → Neon (pick the Mumbai or Singapore region). This injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). If you use another provider, set both by hand. For a pooler, end the pooled URL with `?pgbouncer=true&connection_limit=1`.
3. **Add a Blob store.** Project → Storage → Create → Blob, set to **Private**. This injects `BLOB_READ_WRITE_TOKEN`. Without it, COA uploads fail, because Vercel's disk is read-only.
4. **Set environment variables** (Production, and Preview if you use it):

   | Variable | Value |
   |---|---|
   | `AUTH_SECRET` | `openssl rand -base64 32` |
   | `COMPANY_NAME`, `COMPANY_GSTIN`, `COMPANY_ADDRESS` | Printed on delivery challans |

   `AUTH_TRUST_HOST` is not needed on Vercel.
5. **Deploy.** The first production build runs `prisma migrate deploy` against the empty database.
6. **Create the first user** from your machine, pointing at the production database:

   ```bash
   DATABASE_URL="<DATABASE_URL_UNPOOLED value>" npm run admin:create
   ```

   For a demo, run `npm run db:seed` and then `npm run db:seed:demo` the same way. The seed creates one user per role with known passwords, so do not seed a real production database.

## CI/CD (GitHub Actions)

The `deploy` job in `.github/workflows/ci.yml` runs after typecheck, lint, tests and the build pass. A push to `main` deploys to **production**. A push to any other deploying branch (currently `design_changes`) and any pull request from this repo deploys a **preview** with its own URL, shown in the run summary. Pull requests from forks are not deployed.

It uses the Vercel CLI instead of Vercel's GitHub integration, which works on any Vercel plan and keeps deploys behind the tests. Set it up once:

1. Create the project: `npx vercel login`, then `npx vercel link` in this folder, choosing the `prismai1202s-projects` scope and a new project named `ims`. Linking writes `.vercel/project.json` (git-ignored) with the two ids you need.
2. Do the "One-time setup" steps above (database, Blob store, env variables) for **Production** and **Preview**.
3. Create a token at vercel.com/account/tokens.
4. In GitHub → repo Settings → Secrets and variables → Actions, add:
   - `VERCEL_TOKEN`: the token
   - `VERCEL_ORG_ID`: `orgId` from `.vercel/project.json`
   - `VERCEL_PROJECT_ID`: `projectId` from `.vercel/project.json`
5. If Vercel's own GitHub integration is also connected to this repo, turn it off (Project → Settings → Git → Disconnect) so each push is not deployed twice.

To deploy more branches, add them to `push.branches` in `ci.yml`.

## Day to day

- **Production** deploys from `main`. Migrations run automatically, so commit the migration files from `prisma migrate dev`.
- **Previews** skip migrations. The Neon integration can give each preview its own database branch; if you use that, set `RUN_MIGRATIONS=1` for the Preview environment. Never point a preview at the production database.
- **Rolling back** the app is a one-click redeploy of an older build. Migrations are not rolled back, so keep them additive.

## What does not work on Vercel

- **Label printing over the network.** `PRINTER_HOST` opens a raw TCP connection to the printer, and Vercel cannot reach a printer on your LAN. Print labels from a machine on the plant network (run the app there) or export the ZPL and send it from a local helper.
- **Local disk uploads.** `UPLOAD_DIR` is ignored when `BLOB_READ_WRITE_TOKEN` is set.
- **Existing uploaded files** from another environment are not copied across. Re-upload them, or copy the files into the Blob store under `uploads/<name>`.

## Checks before the first deploy

```bash
npm run typecheck && npm run lint && npm test
VERCEL=1 npm run build     # same Next config Vercel uses (no standalone output)
```
