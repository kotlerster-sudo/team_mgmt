// Create or reorder step templates (setup or visit) for a domain.
//   POST { op: "create", kind: "setup"|"visit", domain, title }
//   POST { op: "reorder", kind, domain, orderedIds: string[] }
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "step";
}

export async function POST(req: NextRequest) {
  if (!(await requireFieldAdmin())) return Response.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const kind = b.kind === "visit" ? "visit" : "setup";
  const domain: string = b.domain ?? "";
  if (!domain) return Response.json({ error: "domain required" }, { status: 400 });

  if (b.op === "reorder") {
    const ids: string[] = Array.isArray(b.orderedIds) ? b.orderedIds : [];
    const model = kind === "visit" ? prisma.visitStepTemplate : prisma.setupStepTemplate;
    await prisma.$transaction(ids.map((id, i) => (model as any).update({ where: { id }, data: { order: i } })));
    return Response.json({ ok: true });
  }

  // create
  const title: string = (b.title ?? "New step").trim() || "New step";
  let stepKey = slug(title);
  const model = kind === "visit" ? prisma.visitStepTemplate : prisma.setupStepTemplate;
  // Ensure the (domain, stepKey) unique key doesn't collide.
  const existing = new Set((await (model as any).findMany({ where: { domain }, select: { stepKey: true, order: true } })).map((r: { stepKey: string }) => r.stepKey));
  if (existing.has(stepKey)) { let n = 2; while (existing.has(`${stepKey}-${n}`)) n++; stepKey = `${stepKey}-${n}`; }
  const maxOrder = await (model as any).aggregate({ where: { domain }, _max: { order: true } });
  const order = (maxOrder._max.order ?? -1) + 1;

  const row = await (model as any).create({ data: { domain, stepKey, title, order } });
  return Response.json({ ok: true, id: row.id, stepKey });
}
