import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAdminUser } from "@/lib/roleGuard";
import { slugifyChecklistText, normalizeActivities, type DbPitstop, type DbChecklistItem } from "@/lib/templateDb";
import { syncTemplateDefs } from "@/lib/controlplane/sync";

// Powers the catalog editor's "tag from template" picker + "add new activity" flow.
//
// GET  ?domain=<d>  → the domain's goal template(s), expanded pitstop → checklist item, each with
//                     its resolved completionType + whether it carries an indicator binding.
// POST { templateSlug, pitstopKey, text, completionType } → append a new checklist item to that
//                     template pitstop (writes GoalTemplateDef) and return its ref for tagging.

const ckKey = (c: DbChecklistItem) => c.key || slugifyChecklistText(c.text);
const psKey = (p: DbPitstop) => p.key || slugifyChecklistText(p.title);
const ckCompletion = (c: DbChecklistItem) =>
  c.completionType || normalizeActivities(c)[0]?.completionType || "Activity";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) return Response.json({ templates: [] });

  const defs = await prisma.goalTemplateDef.findMany({
    where: { needsDomain: domain, isActive: true },
    select: { slug: true, name: true, pitstops: true },
    orderBy: { sortOrder: "asc" },
  });

  // One binding lookup per template for the indicator badges.
  const bindings = await prisma.activityIndicatorBinding.findMany({
    where: { templateSlug: { in: defs.map((d) => d.slug) } },
    select: { templateSlug: true, checklistKey: true },
  });
  const bound = new Set(bindings.map((b) => `${b.templateSlug}::${b.checklistKey}`));

  const templates = defs.map((d) => {
    const pitstops = ((d.pitstops ?? []) as unknown as DbPitstop[]).map((p) => ({
      title: p.title,
      key: psKey(p),
      checklist: (p.checklist ?? []).map((c) => {
        const key = ckKey(c);
        return { key, text: c.text, completionType: ckCompletion(c), hasIndicator: bound.has(`${d.slug}::${key}`) };
      }),
    }));
    return { slug: d.slug, name: d.name, pitstops };
  });

  return Response.json({ templates });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdminUser(session)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const templateSlug: string = (body?.templateSlug ?? "").trim();
  const pitstopKey: string = (body?.pitstopKey ?? "").trim();
  const text: string = (body?.text ?? "").trim();
  const completionType: string = body?.completionType || "Activity";
  if (!templateSlug || !pitstopKey || !text) {
    return Response.json({ error: "templateSlug, pitstopKey and text are required" }, { status: 400 });
  }

  const def = await prisma.goalTemplateDef.findUnique({
    where: { slug: templateSlug },
    select: { id: true, pitstops: true },
  });
  if (!def) return Response.json({ error: "Template not found" }, { status: 404 });

  const pitstops = (def.pitstops ?? []) as unknown as DbPitstop[];
  const target = pitstops.find((p) => psKey(p) === pitstopKey);
  if (!target) return Response.json({ error: "Pitstop not found in template" }, { status: 404 });

  const checklistKey = slugifyChecklistText(text);
  if ((target.checklist ?? []).some((c) => ckKey(c) === checklistKey)) {
    return Response.json({ error: "A checklist item with this name already exists in that pitstop" }, { status: 409 });
  }

  // Append the checklist item (+ a mirror activity so template-apply schedules a real activity).
  const newItem: DbChecklistItem = {
    text,
    key: checklistKey,
    completionType,
    activities: [{ title: text, completionType, key: checklistKey }],
  };
  target.checklist = [...(target.checklist ?? []), newItem];

  await prisma.goalTemplateDef.update({
    where: { id: def.id },
    data: { pitstops: pitstops as unknown as object[] },
  });

  // Dual-write the relational config-graph tables (critical: reads may be on relational).
  try {
    await syncTemplateDefs(def.id, pitstops);
  } catch (syncErr) {
    console.error("[admin/template-items POST] control-plane dual-write failed:", syncErr);
  }

  return Response.json({ templateSlug, checklistKey, text, completionType });
}
