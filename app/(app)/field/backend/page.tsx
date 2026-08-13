import { redirect } from "next/navigation";
import { requireFieldAdmin } from "@/lib/field/access";
import { loadFieldBackend, loadAvailableDomains } from "@/lib/field/adminData";
import { BackendConsole } from "./_components/BackendConsole";

export const dynamic = "force-dynamic";

// The /field backend console — the config that drives the RP frontend, editable,
// with a live-data snapshot. Admin-only.
export default async function FieldBackendPage() {
  if (!(await requireFieldAdmin())) redirect("/field");
  const [domains, available] = await Promise.all([loadFieldBackend(), loadAvailableDomains()]);
  return <BackendConsole domains={JSON.parse(JSON.stringify(domains))} available={available} />;
}
