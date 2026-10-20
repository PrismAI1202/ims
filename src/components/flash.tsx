export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`rounded-xl px-3 py-2.5 text-sm font-medium ${error ? "bg-danger-bg text-danger" : "bg-ok-bg text-ok-ink"}`}
    >
      {error ?? ok}
    </p>
  );
}

export const inputCls =
  "mt-1 w-full min-h-12 rounded-xl border border-border bg-white px-3.5 text-base text-ink";
export const btnCls =
  "inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-5 text-[15px] font-semibold text-white hover:bg-accent-hover cursor-pointer";
export const btnSecondaryCls =
  "inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-white px-5 text-[15px] font-semibold text-ink hover:bg-canvas cursor-pointer";
export const btnOkCls =
  "inline-flex min-h-12 items-center justify-center rounded-xl bg-ok px-5 text-[15px] font-semibold text-white cursor-pointer";
export const btnWarnCls =
  "inline-flex min-h-12 items-center justify-center rounded-xl bg-[#f5c451] px-5 text-[15px] font-semibold text-[#3a2a00] cursor-pointer";
export const btnDangerCls =
  "inline-flex min-h-12 items-center justify-center rounded-xl bg-danger px-5 text-[15px] font-semibold text-white cursor-pointer";
