import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { listTemplateChecklistKeys } from "@/lib/controlplane/keys";

// Enumerate taggable checklist keys per active template. Reads the relational config tables (P2b
// cutover) instead of parsing GoalTemplateDef.pitstops JSON; dual-write keeps them in lockstep.
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await listTemplateChecklistKeys());
}
