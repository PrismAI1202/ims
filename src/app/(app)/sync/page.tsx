import { ComingSoon } from "@/components/ui";
import { STUBS } from "@/components/nav-data";

export const instant = false;

export default function Page() {
  const s = STUBS.sync;
  return <ComingSoon title={s.title} what={s.what} />;
}
