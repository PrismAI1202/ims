import { LogOut } from "lucide-react";
import { signOut } from "@/auth";

/** Compact pill pinned to the top-right of every signed-in screen (positioned by the layout). */
export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[10px] bg-on-shell px-3 text-[13px] font-semibold text-ink">
        <LogOut size={15} aria-hidden /> Sign out
      </button>
    </form>
  );
}
