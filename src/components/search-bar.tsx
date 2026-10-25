import Link from "next/link";
import { Search } from "lucide-react";

/**
 * A search box for list pages. It is a plain GET form, so it works without JavaScript and the result is a
 * shareable URL. `keep` carries the other filters (tab, status…) through the search; `clearHref` resets it.
 */
export function SearchBar({
  q, placeholder, keep = {}, clearHref,
}: { q?: string; placeholder: string; keep?: Record<string, string | undefined>; clearHref: string }) {
  return (
    <form method="get" role="search" className="flex gap-2">
      {Object.entries(keep).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <label className="relative flex-1">
        <span className="sr-only">Search</span>
        <Search size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search" name="q" defaultValue={q} placeholder={placeholder} enterKeyHint="search" autoComplete="off"
          className="min-h-12 w-full rounded-xl border border-border bg-white pl-10 pr-3 text-base"
        />
      </label>
      <button className="min-h-12 cursor-pointer rounded-xl bg-ink px-4 text-sm font-semibold text-white">Search</button>
      {q && <Link href={clearHref} className="flex min-h-12 items-center rounded-xl px-2 text-sm font-semibold text-accent">Clear</Link>}
    </form>
  );
}
