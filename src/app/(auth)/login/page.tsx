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

// DEMO ONLY: one-tap sign-in per role while nobody uses the app yet. Delete this block, `demoLogin`, and the
// "Demo sign-in" section in the JSX below when the demo is over. Uses the seeded accounts from prisma/seed.ts.
const DEMO_LOGINS = [
  { email: "demo@ims.local", label: "Demo (all views)" },
  { email: "admin@ims.local", label: "Admin" },
  { email: "store@ims.local", label: "Store incharge" },
  { email: "qa@ims.local", label: "QA inspector" },
  { email: "production@ims.local", label: "Production lead" },
  { email: "dispatch@ims.local", label: "Dispatch officer" },
  { email: "planner@ims.local", label: "Planner" },
];

async function demoLogin(formData: FormData) {
  "use server";
  const email = String(formData.get("email"));
  if (!DEMO_LOGINS.some((d) => d.email === email)) redirect("/login?error=1");
  try {
    await signIn("credentials", { email, password: "password123", redirectTo: "/dashboard" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=1");
    throw e;
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
      <div className="flex w-full max-w-sm flex-col gap-7 px-6 pb-8 pt-16">
        <div className="flex flex-col gap-2.5">
          <span className="flex size-13 items-center justify-center rounded-[14px] bg-accent">
            <Layers size={28} color="#fff" aria-hidden />
          </span>
          <span className="font-mono text-xs tracking-[0.08em] text-on-shell-2">PLANT 2 · MOULDING SHOP</span>
          <h1 className="font-display text-[34px] font-extrabold leading-[1.05]">Inventory &amp; traceability</h1>
        </div>
        <form action={login} className="flex flex-col gap-3.5">
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
        </form>
        <section aria-label="Demo sign-in" className="flex flex-col gap-2.5">
          <span className="font-mono text-xs tracking-[0.08em] text-on-shell-2">DEMO SIGN-IN · TAP A ROLE</span>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_LOGINS.map((d) => (
              <form key={d.email} action={demoLogin} className="contents">
                <input type="hidden" name="email" value={d.email} />
                <button type="submit"
                  className="min-h-11 w-full cursor-pointer rounded-xl border-[1.5px] border-shell-line bg-shell-2 px-3 text-sm text-white hover:border-accent">
                  {d.label}
                </button>
              </form>
            ))}
          </div>
        </section>
        <div className="mt-auto text-xs text-on-shell-2">Injection Moulding Unit · v1.0</div>
      </div>
    </main>
  );
}
