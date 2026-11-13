// Wipes the plant's data and loads the demo fresh (prisma/seed-demo.ts). Users, roles, API tokens, push subscriptions and settings
// are kept, so people stay signed in and keep their access. Dates in the demo are relative to the day this runs, so run it again
// the day before a demo to bring everything up to date.
//
//   npm run demo:reset -- --yes
//   DATABASE_URL="<direct connection string>" DEMO_RESET_HOSTED=1 npm run demo:reset -- --yes     (a hosted database)
//
// It refuses to run without --yes, and refuses a database that is not on this machine unless DEMO_RESET_HOSTED=1 is set, so a
// stray DATABASE_URL cannot wipe the wrong place. It prints exactly which database it is about to wipe.
import { PrismaClient } from "@prisma/client";
import { loadAllDemo } from "./seed-demo";

const KEEP = new Set(["User", "AccessRole", "ApiToken", "PushSubscription", "AppSetting", "_prisma_migrations"]);
const prisma = new PrismaClient();

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://missing");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  console.log(`Database: ${url.hostname}:${url.port || "5432"}${url.pathname}  (${local ? "this machine" : "HOSTED"})`);
  if (!process.argv.includes("--yes")) { console.error("Not wiping anything. Re-run with --yes to confirm."); process.exit(1); }
  if (!local && process.env.DEMO_RESET_HOSTED !== "1") { console.error("This is not a local database. Set DEMO_RESET_HOSTED=1 as well to wipe it."); process.exit(1); }

  const [lots, pos, orders] = await Promise.all([prisma.lot.count(), prisma.purchaseOrder.count(), prisma.demandLine.count()]);
  console.log(`About to delete the plant data: ${lots} lots, ${pos} purchase orders, ${orders} customer order lines, and everything linked to them.`);

  const tables = (await prisma.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`))
    .map((t) => t.tablename).filter((t) => !KEEP.has(t));
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`Cleared ${tables.length} tables. Loading the demo…`);

  await loadAllDemo();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
