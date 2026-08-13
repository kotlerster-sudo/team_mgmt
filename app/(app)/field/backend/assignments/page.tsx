import { redirect } from "next/navigation";
import { requireFieldAdmin } from "@/lib/field/access";
import { loadAssignments, loadCreatePickers } from "@/lib/field/adminData";
import { AssignmentsEditor } from "./_components/AssignmentsEditor";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  if (!(await requireFieldAdmin())) redirect("/field");
  const [data, pickers] = await Promise.all([loadAssignments(), loadCreatePickers()]);
  return <AssignmentsEditor data={JSON.parse(JSON.stringify(data))} layerKeyByDomain={pickers.layerKeyByDomain} users={pickers.users} />;
}
