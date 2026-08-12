import { redirect, notFound } from "next/navigation";
import { getFieldSession } from "@/lib/field/access";
import { loadIntervention } from "@/lib/field/queries";
import { InterventionDetail } from "./_components/InterventionDetail";

export const dynamic = "force-dynamic";

// Screen 3 — one intervention: setup steps OR the live visit, plus follow-ups.
export default async function InterventionPage({ params }: { params: Promise<{ goalId: string }> }) {
  const sess = await getFieldSession();
  if (!sess) redirect("/operations");
  const { goalId } = await params;
  const data = await loadIntervention(goalId);
  if (!data) notFound();

  // Serialize dates to ISO for the client boundary.
  return <InterventionDetail data={JSON.parse(JSON.stringify(data))} />;
}
