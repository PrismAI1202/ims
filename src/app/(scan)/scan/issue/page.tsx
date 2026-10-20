import { requirePermission } from "@/server/auth/guard";
import { IssueForm } from "./issue-form";

export const instant = false;

export default async function ScanIssue() {
  await requirePermission("stock.issue");
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-extrabold">Issue to shop floor</h1>
      <IssueForm />
    </div>
  );
}
