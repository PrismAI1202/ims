export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`rounded p-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}
    >
      {error ?? ok}
    </p>
  );
}

export const inputCls = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm";
export const btnCls = "rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700";
