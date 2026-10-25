import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, detectType, fileUrl, isFileRef, readUpload, saveUpload } from "./storage";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
const HTML = new TextEncoder().encode("<script>alert(1)</script>");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ims-uploads-"));
  process.env.UPLOAD_DIR = dir;
});
afterAll(async () => {
  delete process.env.UPLOAD_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("detectType", () => {
  it("accepts real PDF, PNG and JPG content with matching extensions", () => {
    expect(detectType("coa.PDF", PDF).mime).toBe("application/pdf");
    expect(detectType("scan.png", PNG).mime).toBe("image/png");
    expect(detectType("photo.jpeg", JPG).ext).toBe("jpg");
    expect(detectType("photo.jpg", JPG).mime).toBe("image/jpeg");
  });
  it("refuses unsupported extensions", () => {
    expect(() => detectType("run.exe", EXE)).toThrow(/PDF, PNG or JPG/);
    expect(() => detectType("page.html", HTML)).toThrow(/PDF, PNG or JPG/);
    expect(() => detectType("noextension", PDF)).toThrow(/PDF, PNG or JPG/);
  });
  it("refuses a file whose contents don't match its name", () => {
    expect(() => detectType("coa.pdf", EXE)).toThrow(/don't match/);
    expect(() => detectType("coa.pdf", HTML)).toThrow(/don't match/);
    expect(() => detectType("img.png", PDF)).toThrow(/don't match/);
  });
});

describe("saveUpload / readUpload", () => {
  it("stores under a generated name and reads it back with the right type", async () => {
    const ref = await saveUpload({ name: "../../etc/passwd.pdf", bytes: PDF }); // hostile name is ignored
    expect(isFileRef(ref)).toBe(true);
    const name = ref.slice(5);
    expect((await readdir(dir))).toContain(name);
    expect(name).not.toContain("passwd");
    const got = await readUpload(name);
    expect(got?.mime).toBe("application/pdf");
    expect([...got!.bytes]).toEqual([...PDF]);
    expect(fileUrl(ref)).toBe(`/api/v1/files/${name}`);
  });

  it("gives each upload its own name", async () => {
    const a = await saveUpload({ name: "a.png", bytes: PNG });
    const b = await saveUpload({ name: "a.png", bytes: PNG });
    expect(a).not.toBe(b);
  });

  it("rejects empty, oversized and mismatched uploads without writing anything", async () => {
    const before = (await readdir(dir)).length;
    await expect(saveUpload({ name: "x.pdf", bytes: new Uint8Array(0) })).rejects.toThrow(/empty/);
    await expect(saveUpload({ name: "x.pdf", bytes: new Uint8Array(MAX_FILE_BYTES + 1) })).rejects.toThrow(/5 MB/);
    await expect(saveUpload({ name: "x.pdf", bytes: EXE })).rejects.toThrow(/don't match/);
    expect((await readdir(dir)).length).toBe(before);
  });

  it("only reads names it generated: traversal and odd names return nothing", async () => {
    for (const bad of ["../package.json", "..%2f..%2fetc%2fpasswd", "a.pdf", "../../x.pdf", "/etc/passwd", "11111111-1111-1111-1111-111111111111.exe", ""]) {
      expect(await readUpload(bad)).toBeNull();
    }
    expect(await readUpload("11111111-1111-1111-1111-111111111111.pdf")).toBeNull(); // well-formed but absent
  });

  it("isFileRef is false for plain text references", () => {
    expect(isFileRef("COA-PP-7781.pdf")).toBe(false);
    expect(isFileRef("file:../../x")).toBe(false);
    expect(isFileRef(null)).toBe(false);
  });
});
