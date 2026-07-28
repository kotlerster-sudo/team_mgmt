import prisma from "@/lib/prisma";
import type { CatalogCategory, CentreCatalogOverrides } from "@/lib/catalogDb";

export type VisitContext = {
  eventId: string;
  scheduledAt: Date;
  pitstopId: string;
  goalId: string;
  catalogSlug: string;
  snapshot: CatalogCategory[];
  overrides: CentreCatalogOverrides;
};

/**
 * Resolve a Visit event's anchoring pitstop + goal + the centre's frozen catalog. Returns null if
 * the event isn't linked to a pitstop/goal or the goal has no CentreCatalog (i.e. not a live centre).
 */
export async function loadVisitContext(eventId: string): Promise<VisitContext | null> {
  const event = await prisma.pitstopEvent.findFirst({
    where: { id: eventId, deletedAt: null },
    select: {
      id: true,
      scheduledAt: true,
      pitstops: {
        where: { pitstop: { deletedAt: null } },
        select: { pitstop: { select: { id: true, goalId: true } } },
        take: 1,
      },
    },
  });
  const link = event?.pitstops[0]?.pitstop;
  if (!event || !link) return null;

  const catalog = await prisma.centreCatalog.findUnique({
    where: { goalId: link.goalId },
    select: { catalogSlug: true, snapshot: true, overrides: true },
  });
  if (!catalog) return null;

  return {
    eventId: event.id,
    scheduledAt: event.scheduledAt,
    pitstopId: link.id,
    goalId: link.goalId,
    catalogSlug: catalog.catalogSlug,
    snapshot: (catalog.snapshot ?? []) as unknown as CatalogCategory[],
    overrides: (catalog.overrides ?? {}) as unknown as CentreCatalogOverrides,
  };
}
