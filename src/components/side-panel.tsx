import Link from "next/link";
import { X } from "lucide-react";

/**
 * A panel that slides in over a list from the right (a full-screen sheet on a phone). It is opened by a link that adds a
 * query parameter and closed by a link that removes it, so it survives a reload and needs no client code of its own.
 */
export function SidePanel({ title, subtitle, closeHref, children }: { title: string; subtitle?: string; closeHref: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-black/45" />
      <section className="absolute inset-y-0 right-0 flex w-full flex-col bg-canvas shadow-2xl md:w-[min(64rem,94vw)]">
        <header className="flex items-start justify-between gap-3 border-b border-line bg-white px-4 py-3.5 md:px-6">
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-lg font-extrabold leading-tight">{title}</span>
            {subtitle && <span className="text-[13px] text-ink-3">{subtitle}</span>}
          </span>
          <Link href={closeHref} scroll={false} aria-label="Close" className="flex size-11 flex-none items-center justify-center rounded-xl bg-canvas hover:bg-line"><X size={20} aria-hidden /></Link>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 md:p-6">{children}</div>
      </section>
    </div>
  );
}
