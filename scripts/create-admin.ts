// Creates the first administrator on a fresh deployment, so production never needs the demo seed accounts.
// Usage:  ADMIN_PASSWORD='a-long-passphrase' npm run admin:create -- admin@yourplant.com "Plant Admin"
// The password comes from the environment, not the command line, so it doesn't land in shell history or process lists.
import { PrismaClient } from "@prisma/client";
import { createUser } from "../src/server/services/users";

const prisma = new PrismaClient();

async function main() {
  const [email, name] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !name || !password) throw new Error("Usage: ADMIN_PASSWORD='…' npm run admin:create -- <email> \"<name>\"");
  const u = await createUser({ email, name, role: "ADMIN", password }, prisma);
  console.log(`Created admin ${u.email}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
