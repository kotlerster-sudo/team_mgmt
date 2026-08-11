import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getEnumLabels } from "@/lib/enumLabels";

// GET /api/enum-labels?enumKey=CaregiverPracticeStatus — editable display labels (seeds defaults).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const enumKey = new URL(req.url).searchParams.get("enumKey");
  if (!enumKey) return Response.json({ error: "enumKey required" }, { status: 400 });
  return Response.json(await getEnumLabels(enumKey));
}
