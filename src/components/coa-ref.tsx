import { fileUrl, isFileRef } from "@/server/services/storage";
import { DownloadLink } from "./download-link";

// A COA is either an uploaded file (shown as a link) or a typed reference (shown as text).
export function CoaRef({ value }: { value: string | null | undefined }) {
  if (!value) return <>—</>;
  if (isFileRef(value)) return <DownloadLink href={fileUrl(value)}>View certificate</DownloadLink>;
  return <>{value}</>;
}
