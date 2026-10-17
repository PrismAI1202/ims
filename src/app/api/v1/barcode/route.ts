import bwipjs from "bwip-js/node";
import { auth } from "@/auth";

// GET /api/v1/barcode?text=LOT-...&type=qr|code128 → PNG. Used by printable tags and bin labels.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text");
  const type = searchParams.get("type") === "code128" ? "code128" : "qrcode";
  if (!text || text.length > 200) return new Response("Bad text", { status: 400 });

  // bwip-js rejects explicit undefined options, so only add the linear-barcode ones when needed.
  const png = await bwipjs.toBuffer(
    type === "code128"
      ? { bcid: "code128", text, scale: 3, height: 12, includetext: true }
      : { bcid: "qrcode", text, scale: 4 },
  );
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
}
