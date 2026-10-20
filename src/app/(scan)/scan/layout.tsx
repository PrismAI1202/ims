import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { RegisterSw } from "./register-sw";

export const instant = false;

export default async function ScanLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="mx-auto min-h-screen max-w-md bg-canvas">
      <RegisterSw />
      <header className="flex items-end justify-between gap-3 bg-shell px-5 pb-4 pt-8 text-on-shell">
        <div>
          <div className="font-mono text-xs tracking-[0.06em] text-on-shell-2">PLANT 2 · MOULDING SHOP</div>
          <Link href="/scan" className="font-display text-2xl font-extrabold">Scanner</Link>
        </div>
        <Link href="/dashboard" className="flex min-h-11 items-center rounded-[10px] bg-on-shell px-3.5 text-sm font-semibold text-ink">
          Home
        </Link>
      </header>
      <div className="p-4">{children}</div>
    </div>
  );
}
