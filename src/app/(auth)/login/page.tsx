import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { Layers } from "lucide-react";
import { signIn } from "@/auth";

export const instant = false;

async function login(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=1");
    throw e; // NEXT_REDIRECT must propagate
  }
}

const darkInput =
  "mt-1.5 w-full min-h-13 rounded-xl border-[1.5px] bg-shell-2 px-3.5 text-base text-white";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen justify-center bg-shell text-on-shell">
      <form action={login} className="flex w-full max-w-sm flex-col gap-7 px-6 pb-8 pt-16">
        <div className="flex flex-col gap-2.5">
          <span className="flex size-13 items-center justify-center rounded-[14px] bg-accent">
            <Layers size={28} color="#fff" aria-hidden />
          </span>
          <span className="font-mono text-xs tracking-[0.08em] text-on-shell-2">PLANT 2 · MOULDING SHOP</span>
          <h1 className="font-display text-[34px] font-extrabold leading-[1.05]">Inventory &amp; traceability</h1>
        </div>
        <div className="flex flex-col gap-3.5">
          <label className="block text-[13px] text-[#d5d7db]">
            Email
            <input name="email" type="email" required autoComplete="username"
              className={`${darkInput} ${error ? "border-[#ff8a78]" : "border-shell-line"}`} />
          </label>
          <label className="block text-[13px] text-[#d5d7db]">
            Password
            <input name="password" type="password" required autoComplete="current-password"
              className={`${darkInput} border-shell-line`} />
          </label>
          {error && (
            <p role="alert" className="text-[13px] text-[#ffb4a8]">Invalid email or password.</p>
          )}
          <button className="min-h-13 cursor-pointer rounded-xl bg-accent text-base font-semibold text-white hover:bg-accent-hover">
            Sign in
          </button>
        </div>
        <div className="mt-auto text-xs text-on-shell-2">Injection Moulding Unit · v1.0</div>
      </form>
    </main>
  );
}
