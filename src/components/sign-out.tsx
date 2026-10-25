import { LogOut } from "lucide-react";
import { signOut } from "@/auth";
import { headerBtnCls } from "./ui";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button className={`${headerBtnCls} cursor-pointer`}>
        <LogOut size={16} aria-hidden /> Sign out
      </button>
    </form>
  );
}
