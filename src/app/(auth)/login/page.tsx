import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <form action={login} className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Inventory Management</h1>
          <p className="text-sm text-slate-500">Injection Moulding Unit</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 rounded p-2">
            Invalid email or password.
          </p>
        )}
        <label className="block text-sm">
          Email
          <input name="email" type="email" required autoComplete="username"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          Password
          <input name="password" type="password" required autoComplete="current-password"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <button className="w-full rounded bg-slate-900 text-white py-2 font-medium">Sign in</button>
      </form>
    </main>
  );
}
