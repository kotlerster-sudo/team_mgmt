import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { ENUM_LABEL_KEYS, getEnumLabels } from "@/lib/enumLabels";

// GET → all enum groups with their labels (seeds defaults). PUT → edit one row's label/color.
export async function GET() {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const groups = await Promise.all(ENUM_LABEL_KEYS.map(async (enumKey) => ({ enumKey, labels: await getEnumLabels(enumKey) })));
  return Response.json(groups);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { enumKey, code, label, color } = await req.json();
  if (!enumKey || !code || !label?.trim()) return Response.json({ error: "enumKey, code, label required" }, { status: 400 });
  await prisma.enumLabelConfig.update({
    where: { enumKey_code: { enumKey, code } },
    data: { label: label.trim(), color: color ?? null },
  });
  return Response.json({ ok: true });
}
