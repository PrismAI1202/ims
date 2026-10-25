export type Role =
  | "ADMIN"
  | "STORE_INCHARGE"
  | "QA_INSPECTOR"
  | "PRODUCTION_LEAD"
  | "DISPATCH_OFFICER";

export type Permission =
  | "masters.manage"
  | "po.manage"
  | "grn.create"
  | "qc.inspect"
  | "stock.view"
  | "stock.transfer"
  | "stock.issue"
  | "reorder.view"
  | "request.create"
  | "production.book"
  | "bom.manage"
  | "fg.pack"
  | "mrp.plan"
  | "users.manage"
  | "scrap.approve"
  | "reports.view"
  | "dispatch.manage";

// SRS §5 role matrix. ADMIN holds everything.
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [
    "masters.manage", "po.manage", "grn.create", "qc.inspect", "stock.view",
    "stock.transfer", "stock.issue", "reorder.view", "request.create",
    "production.book", "bom.manage", "fg.pack", "mrp.plan", "users.manage", "scrap.approve", "reports.view", "dispatch.manage",
  ],
  STORE_INCHARGE: [
    "po.manage", "grn.create", "stock.view", "stock.transfer", "stock.issue", "reorder.view",
    "mrp.plan", "reports.view",
  ],
  QA_INSPECTOR: ["qc.inspect", "scrap.approve", "stock.view", "reports.view"],
  PRODUCTION_LEAD: ["request.create", "production.book", "fg.pack", "stock.view", "reports.view"],
  DISPATCH_OFFICER: ["dispatch.manage", "fg.pack", "stock.view"],
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertCan(role: Role | undefined | null, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ForbiddenError(permission);
  }
}

export class ForbiddenError extends Error {
  constructor(public permission: Permission) {
    super(`Forbidden: missing permission ${permission}`);
    this.name = "ForbiddenError";
  }
}
