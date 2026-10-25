import { saveUpload } from "./services/storage";

/** Saves the file from a form field (if one was chosen) and returns its stored reference. */
export async function uploadFrom(formData: FormData, field: string): Promise<string | undefined> {
  const f = formData.get(field);
  if (!(f instanceof File) || f.size === 0) return undefined;
  return saveUpload({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
}
