import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/roleGuard";
import { assembleControlPlaneGraph } from "@/lib/controlplane/assemble";

// GET /api/admin/control-plane/graph?domain=Creche — the assembled programme graph (read-only in P1).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const domain = url.searchParams.get("domain");
  const connectedOnly = url.searchParams.get("connected") !== "0";
  try {
    const graph = await assembleControlPlaneGraph(domain, { connectedOnly });
    return Response.json(graph);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
