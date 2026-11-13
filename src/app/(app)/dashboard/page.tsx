import { requireUser } from "@/server/auth/guard";
import { WIDGET_COMPONENTS } from "@/components/home";
import { Flash } from "@/components/flash";
import { PageHeader } from "@/components/ui";

export const instant = false;

// Home is built from the blocks listed on the user's role (Settings · Roles & access), in that order.
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const user = await requireUser();
  const { error, status } = await searchParams;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PLANT 2 · MOULDING SHOP"
        title={user.name ?? "Home"}
        subtitle={(user.name ?? "").toLowerCase() === user.roleName.toLowerCase() ? undefined : user.roleName}
      />
      <Flash error={error} />
      {user.home.map((key) => {
        const Widget = WIDGET_COMPONENTS[key];
        return <Widget key={key} user={user} stockStatus={status} />;
      })}
    </div>
  );
}
