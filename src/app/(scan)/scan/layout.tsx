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
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 p-4">
      <RegisterSw />
      <header className="mb-4 flex items-center justify-between">
        <Link href="/scan" className="text-lg font-semibold">IMS Scanner</Link>
        <Link href="/dashboard" className="text-sm underline">Desktop view</Link>
      </header>
      {children}
    </div>
  );
}
