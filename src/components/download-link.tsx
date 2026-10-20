// File downloads must be real browser navigations (the response is an attachment), not client-side route
// changes, so next/link is the wrong tool. Keeping them in one component documents that choice, and stops the
// page-link lint rule (which would otherwise flag each literal /api/... href) from nudging people to "fix" them.
export function DownloadLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="underline" href={href}>{children}</a>;
}
