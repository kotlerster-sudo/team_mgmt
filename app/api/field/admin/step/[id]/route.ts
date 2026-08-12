// Edit or delete one step template (setup or visit). `kind` selects the table.
//   PATCH { kind, title?, slaDays?, startSlaDays?, blockedByKey?, formKind?, mandatory? }
//   DELETE ?kind=setup|visit
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

function pickModel(kind: string) {
  return kind === "visit" ? prisma.visitStepTemplate : prisma.setupStepTemplate;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const model = pickModel(b.kind) as any;

  const data: Record<string, unknown> = {};
  if (typeof b.title === "string") data.title = b.title;
  if (b.formKind === null || ["checklist", "questionnaire", "caregiver_practices"].includes(b.formKind)) data.formKind = b.formKind || null;
  // setup-only fields
  if (b.slaDays === null || Number.isFinite(b.slaDays)) data.slaDays = b.slaDays;
  if (b.startSlaDays === null || Number.isFinite(b.startSlaDays)) data.startSlaDays = b.startSlaDays;
  if (b.blockedByKey === null || typeof b.blockedByKey === "string") data.blockedByKey = b.blockedByKey || null;
  // visit-only field
  if (typeof b.mandatory === "boolean") data.mandatory = b.mandatory;

  // Drop keys that don't exist on the chosen table to avoid Prisma errors.
  if (b.kind === "visit") { delete data.slaDays; delete data.startSlaDays; delete data.blockedByKey; }
  else delete data.mandatory;

  await model.update({ where: { id }, data });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const kind = new URL(req.url).searchParams.get("kind") ?? "setup";
  await (pickModel(kind) as any).delete({ where: { id } });
  return Response.json({ ok: true });
}
