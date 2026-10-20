# Deploying IMS

IMS is one Next.js app plus a PostgreSQL database. This guide covers a self-hosted Docker setup (tested locally) and
outlines AWS and Azure (**not tested here**: they need your cloud accounts, so treat those sections as a checklist, not a
verified recipe).

## What you need in production

| Thing | Why |
|---|---|
| PostgreSQL 14+ | All data. Take regular backups. |
| `AUTH_SECRET` | Signs login sessions. Generate with `openssl rand -base64 32`; keep it secret; changing it logs everyone out. |
| HTTPS in front of the app | The phone-camera scanner and the weighing-scale connection only work over HTTPS. |
| A persistent volume for `UPLOAD_DIR` | Uploaded COA certificates are files, not database rows. |
| `COMPANY_NAME`, `COMPANY_GSTIN`, `COMPANY_ADDRESS` | Printed on delivery challans and used for e-way bill data. |
| `PRINTER_HOST` / `PRINTER_PORT` (optional) | A network Zebra-compatible printer (raw port 9100) for "Send to label printer". |

## Option A: Docker on one server

```bash
cp .env.example .env
# edit .env: AUTH_SECRET, POSTGRES_PASSWORD, COMPANY_*  (see docker-compose.prod.yml for the variables it reads)

docker compose -f docker-compose.prod.yml up -d --build

# create the first administrator (the demo seed accounts are never used in production)
docker compose -f docker-compose.prod.yml --profile tools run --rm \
  -e ADMIN_PASSWORD='a-long-passphrase' app-tools \
  npm run admin:create -- you@yourplant.com "Your Name"
```

Then put a reverse proxy with TLS in front of port 3000 (Caddy is the shortest route: `reverse_proxy app:3000`).
Set `AUTH_URL=https://your.domain` in the app's environment if you serve it on a custom domain.

**Upgrading:** pull the new code, run `docker compose -f docker-compose.prod.yml up -d --build`. The `migrate` service
applies new database migrations before the app starts.

**Backups:** `docker compose exec db pg_dump -U ims ims > backup.sql` on a schedule, plus a copy of the `uploads` volume.
Test a restore before you rely on it.

## Option B: AWS (checklist, untested)

1. **Database:** Amazon RDS for PostgreSQL (Multi-AZ for production, automated backups on). Put it in private subnets.
2. **Image:** build the `runner` and `migrate` targets (`docker build --target runner …`) and push both to ECR.
3. **Run the app:** ECS Fargate (or App Runner) running the `runner` image, behind an Application Load Balancer with an
   ACM certificate. Health check path: `/api/health`.
4. **Migrations:** run the `migrate` image as a one-off ECS task, with the same `DATABASE_URL`, on every release before
   updating the service.
5. **Uploads:** mount an EFS volume at `/data/uploads` (required if you run more than one app instance). Or replace
   `src/server/services/storage.ts` with an S3 implementation; it is the only file that touches the disk.
6. **Secrets:** keep `AUTH_SECRET` and the database password in Secrets Manager and inject them as task environment variables.
7. **First admin:** run a one-off task of the `build` target image with the `admin:create` command.

## Option C: Azure (checklist, untested)

1. **Database:** Azure Database for PostgreSQL – Flexible Server, with backups on.
2. **Image:** push to Azure Container Registry.
3. **Run the app:** Azure Container Apps (or App Service for Containers), ingress on port 3000 with the managed
   certificate, health probe `/api/health`.
4. **Migrations:** a Container Apps Job using the `migrate` image, run on each release.
5. **Uploads:** mount an Azure Files share at `/data/uploads`, or swap `storage.ts` for Blob Storage.
6. **Secrets:** Key Vault references for `AUTH_SECRET` and `DATABASE_URL`.

## Before you go live

- [ ] `AUTH_SECRET` is set to a real random value and is not in git.
- [ ] The site is served over HTTPS.
- [ ] You created a real admin with `admin:create` and **did not** run `npm run db:seed` (it creates demo accounts with a known password).
- [ ] Database backups run and a restore has been tested.
- [ ] `COMPANY_GSTIN` is set (the challan warns until it is).
- [ ] Items have HSN codes and prices, and customers have GSTINs, or e-way bill data will list them as missing.
- [ ] The `uploads` volume is persistent and backed up.
- [ ] Each scanner device has its own token (`npm run token:create -- user@plant "Dock scanner 1"`); revoke by resetting that user's password.
- [ ] Someone has tried the scanner screens on the real devices and the label printer with real labels (see below).

## Things only real hardware can confirm

These are built and unit-tested, but have **not** been run against physical devices:

- Handheld (keyboard-wedge) scanners: they type the code and press Enter, which the scan fields handle. Check your model is set to send Enter.
- Phone-camera scanning of the printed QR codes.
- The weighing scale: output formats for common scales are parsed, but confirm yours sends a unit (kg/g) on each line and set the baud rate to match.
- ZPL output on your printer model and label size (labels are laid out for 100 × 75 mm at 203 dpi; adjust `src/server/services/zpl.ts` for other sizes).

## Not included

- EDI message parsing (X12 830/862, EDIFACT DELFOR). Schedules are imported from Excel/CSV. EDI needs each customer's message specification.
- Sending the e-way bill to the government portal. IMS produces the data file; upload it or call the portal API from your own integration.
- A native mobile app. The responsive PWA covers scanning today; `docs/API.md` describes what a native app would call.
