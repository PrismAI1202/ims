import type { Label } from "@/server/services/label";

// One printable box label. The QR is rendered by the barcode endpoint; browsers print it straight to a thermal printer.
export function LabelCard({ label, boxCode }: { label: Label; boxCode: string }) {
  return (
    <div className="w-[10cm] break-inside-avoid rounded border-2 border-black bg-white p-3 text-black print:break-after-page print:border">
      <div className="mb-2 flex items-center justify-between border-b border-black pb-1 text-xs font-bold tracking-wide">
        <span>{label.title}</span><span>{boxCode}</span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <dl className="space-y-1 text-sm">
          {label.fields.map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="w-24 text-slate-600">{k}</dt><dd className="font-semibold">{v}</dd></div>
          ))}
        </dl>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/v1/barcode?type=qr&text=${encodeURIComponent(label.qrPayload)}`} alt={`QR ${boxCode}`} width={110} height={110} />
      </div>
    </div>
  );
}
