import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";
import { DomainError } from "./inventory";

// Uploaded certificates live outside the web root and are only served through an authenticated route.
// Two backends: local disk (UPLOAD_DIR, a persistent volume in Docker) or, when BLOB_READ_WRITE_TOKEN is set (Vercel),
// a private Vercel Blob store. Vercel's own filesystem is read-only and wiped between requests, so it cannot hold uploads.
// The paths below are decided at runtime from UPLOAD_DIR, so the bundler is told not to try tracing them (otherwise it
// would pull the whole project into the deployment output).
export const uploadDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? "./uploads");

const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const blobPath = (name: string) => `uploads/${name}`;

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)$/;

const TYPES: Record<string, { ext: string; mime: string; magic: number[] }> = {
  pdf: { ext: "pdf", mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  png: { ext: "png", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  jpg: { ext: "jpg", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  jpeg: { ext: "jpg", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
};

// The filename extension is only a hint; the file's own first bytes must agree, so a renamed .exe or .html is refused.
export function detectType(fileName: string, bytes: Uint8Array) {
  const t = TYPES[fileName.toLowerCase().split(".").pop() ?? ""];
  if (!t) throw new DomainError("Upload a PDF, PNG or JPG file.");
  if (!t.magic.every((b, i) => bytes[i] === b)) throw new DomainError("That file's contents don't match its type. Upload a real PDF, PNG or JPG.");
  return t;
}

// Returns a reference to store on the record: "file:<generated name>".
export async function saveUpload(file: { name: string; bytes: Uint8Array }): Promise<string> {
  if (file.bytes.length === 0) throw new DomainError("The file is empty.");
  if (file.bytes.length > MAX_FILE_BYTES) throw new DomainError("File is larger than 5 MB.");
  const t = detectType(file.name, file.bytes);
  const name = `${randomUUID()}.${t.ext}`;
  if (blobEnabled()) {
    await put(blobPath(name), Buffer.from(file.bytes), { access: "private", addRandomSuffix: false, contentType: t.mime });
    return `file:${name}`;
  }
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(path.join(/*turbopackIgnore: true*/ uploadDir(), name), file.bytes, { flag: "wx" });
  return `file:${name}`;
}

export const isFileRef = (ref: string | null | undefined): ref is string => !!ref && ref.startsWith("file:") && NAME.test(ref.slice(5));
export const fileUrl = (ref: string) => `/api/v1/files/${ref.slice(5)}`;

// Only names we generated can be read: no slashes, dots or traversal can get through the pattern.
export async function readUpload(name: string): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!NAME.test(name)) return null;
  try {
    if (blobEnabled()) {
      const r = await get(blobPath(name), { access: "private" });
      if (!r || r.statusCode !== 200) return null;
      return { bytes: Buffer.from(await new Response(r.stream).arrayBuffer()), mime: r.blob.contentType };
    }
    const bytes = await readFile(path.join(/*turbopackIgnore: true*/ uploadDir(), name));
    return { bytes, mime: Object.values(TYPES).find((t) => t.ext === name.split(".").pop())!.mime };
  } catch {
    return null;
  }
}
