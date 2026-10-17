// Usage: npm run token:create -- <user-email> [label]
// Prints a Bearer token once; only its SHA-256 hash is stored. For scanner devices / the future native app.
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  const [email, label = "device"] = process.argv.slice(2);
  if (!email) throw new Error("Usage: npm run token:create -- <user-email> [label]");
  const user = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
  const token = `ims_${randomBytes(24).toString("hex")}`;
  await prisma.apiToken.create({
    data: { userId: user.id, label, tokenHash: createHash("sha256").update(token).digest("hex") },
  });
  process.stdout.write(`${token}\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
