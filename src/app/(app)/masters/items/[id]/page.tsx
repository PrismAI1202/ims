import { redirect } from "next/navigation";

// Editing an item now happens in a panel on the Masters list; this keeps old links and bookmarks working.
export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/masters?item=${encodeURIComponent(id)}`);
}
