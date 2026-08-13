// Create a new intervention (Goal + materialised setup/visit FieldSteps).
//   POST { domain, title, ownerId?, mode?, anchorAt?, settlementId?, clusterId?, facilityId? }
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireFieldAdmin } from "@/lib/field/access";
import { createIntervention } from "@/lib/field/materialize";

export async function POST(req: NextRequest) {
  const adminId = await requireFieldAdmin();
  if (!adminId) return Response.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth();
  const b = await req.json().catch(() => ({}));

  const domain = String(b?.domain ?? "").trim();
  const title = String(b?.title ?? "").trim();
  if (!domain || !title) return Response.json({ error: "domain + title required" }, { status: 400 });

  const anchorAt = b?.anchorAt ? new Date(b.anchorAt) : new Date();
  try {
    const res = await createIntervention({
      domain,
      title,
      ownerId: b?.ownerId || session!.user!.id!,
      mode: b?.mode === "live" ? "live" : "setup",
      anchorAt: Number.isNaN(anchorAt.getTime()) ? new Date() : anchorAt,
      settlementId: b?.settlementId || null,
      clusterId: b?.clusterId || null,
      facilityId: b?.facilityId || null,
    });
    return Response.json({ ok: true, ...res });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
