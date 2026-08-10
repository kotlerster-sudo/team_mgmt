import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/roleGuard";
import { refreezeLiveCentresForCatalog } from "@/lib/operations/refreeze";

// POST { apply: boolean } — re-freeze the frozen snapshot of every live centre of this catalog's
// domain from the CURRENT (saved) catalog. apply:false = dry-run preview; apply:true = write.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const apply = await req.json().then((b) => Boolean(b?.apply)).catch(() => false);

  try {
    const summary = await refreezeLiveCentresForCatalog(id, { apply });
    return Response.json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 400 });
  }
}
