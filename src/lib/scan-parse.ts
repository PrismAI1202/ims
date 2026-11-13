// What a scan gives back, cleaned up. A bin label or lot tag is the code itself; an OEM box label is a pipe-separated record that
// always ends with the box code (see label.ts), so the last segment is the code to look up.

export const codeOf = (scanned: string): string => scanned.split("|").pop()!.trim();

/** The code as the database holds it: codes are upper-case, and a handheld may add a trailing newline or spaces. */
export const normalizeCode = (scanned: string): string => codeOf(scanned).replace(/\s+/g, "").toUpperCase();
