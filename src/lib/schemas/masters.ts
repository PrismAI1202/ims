import { z } from "zod";

// Shared by the forms, the services and (later) any API client.
const code = z.string().trim().min(2, "Code is too short").max(30).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, . _ - only").transform((s) => s.toUpperCase());
const name = z.string().trim().min(2, "Name is required").max(120);
const qty = z.coerce.number().min(0, "Cannot be negative").max(1e9);

// Blank form fields arrive as "". z.coerce.number() would turn that into 0, which is a real value
// (e.g. 0% regrind = none allowed), so blanks must become "not set" before coercion.
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
const optionalNumber = <T extends z.ZodTypeAny>(n: T) => z.preprocess(blankToUndefined, n.optional());

export const ITEM_CATEGORIES = [
  "RM_RESIN", "RM_MASTERBATCH", "RM_ADDITIVE", "RM_FILLER", "BOP", "PACKAGING", "RETURNABLE", "FG", "REGRIND",
] as const;

export const itemSchema = z
  .object({
    code, name,
    category: z.enum(ITEM_CATEGORIES),
    uom: z.string().trim().min(1).max(10).transform((s) => s.toUpperCase()),
    polymerGrade: z.string().trim().max(30).optional().transform((s) => s || undefined),
    minStock: qty, reorderPoint: qty, maxStock: qty, safetyStock: qty.default(0),
    shelfLifeDays: optionalNumber(z.coerce.number().int().positive()),
    requiresCoa: z.coerce.boolean().default(false),
    maxRegrindPct: optionalNumber(z.coerce.number().min(0).max(100)),
    hsnCode: z.string().trim().max(10).regex(/^\d*$/, "HSN code is digits only").optional().transform((s) => s || undefined),
    unitPrice: optionalNumber(z.coerce.number().min(0)),
  })
  .refine((v) => v.minStock <= v.reorderPoint, { path: ["reorderPoint"], message: "Reorder point must be at least the minimum." })
  .refine((v) => v.maxStock === 0 || v.reorderPoint <= v.maxStock, { path: ["maxStock"], message: "Maximum must be at least the reorder point." });

export const supplierSchema = z.object({ code, name, leadTimeDays: z.coerce.number().int().min(0).max(365) });

export const customerSchema = z.object({
  code, name,
  segment: z.enum(["AUTOMOTIVE", "NON_AUTOMOTIVE"]),
  labelFormat: z.enum(["GENERIC", "OEM"]),
  gstin: z.string().trim().toUpperCase().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN format looks wrong").optional().transform((s) => s || undefined),
  address: z.string().trim().max(300).optional().transform((s) => s || undefined),
});

export const locationSchema = z.object({
  warehouseId: z.string().min(1),
  rack: z.string().trim().min(1).max(10).transform((s) => s.toUpperCase()),
  shelf: z.string().trim().min(1).max(10).transform((s) => s.toUpperCase()),
  bin: z.string().trim().min(1).max(10).transform((s) => s.toUpperCase()),
  type: z.enum(["STORAGE", "STAGING"]).default("STORAGE"),
});

export const machineSchema = z.object({ code, name, tonnage: optionalNumber(z.coerce.number().int().positive()) });

export const mouldSchema = z.object({
  code, name,
  cavities: z.coerce.number().int().min(1).max(256),
  shotWeightG: optionalNumber(z.coerce.number().positive()),
  runnerWeightG: optionalNumber(z.coerce.number().min(0)),
  machineId: z.string().optional().transform((s) => s || undefined),
});

export type ItemInput = z.infer<typeof itemSchema>;
