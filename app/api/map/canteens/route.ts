import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/map/canteens?maxKm=4[&settlement=<id>]
// Without settlement: returns all Indira canteens as GeoJSON with nearby settlement info.
// With settlement:    returns only canteens near that settlement (for sidebar).
export async function GET(req: NextRequest) {
  const maxKm = parseFloat(req.nextUrl.searchParams.get("maxKm") ?? "4");
  const settlementId = req.nextUrl.searchParams.get("settlement") ?? null;

  if (settlementId) {
    const links = await prisma.settlementCanteen.findMany({
      where: { settlementId, distanceKm: { lte: maxKm } },
      include: { canteen: true },
      orderBy: { distanceKm: "asc" },
    });
    return NextResponse.json(
      links.map(l => ({
        id: l.canteen.id,
        name: l.canteen.name,
        address: l.canteen.address ?? "",
        distanceKm: l.distanceKm,
        lat: l.canteen.lat,
        lng: l.canteen.lng,
      }))
    );
  }

  // All canteens as GeoJSON — only canteens with ≥1 settlement within maxKm
  const canteens = await prisma.indiraCanteen.findMany({
    where: { settlements: { some: { distanceKm: { lte: maxKm } } } },
    include: {
      settlements: {
        where: { distanceKm: { lte: maxKm } },
        select: {
          distanceKm: true,
          settlement: {
            select: {
              id: true,
              name: true,
              cluster: { select: { name: true, zone: { select: { name: true } } } },
            },
          },
        },
        orderBy: { distanceKm: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  const features = canteens.map(canteen => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [canteen.lng, canteen.lat] },
    properties: {
      id: canteen.id,
      name: canteen.name,
      address: canteen.address ?? "",
      settlementCount: canteen.settlements.length,
      settlements: canteen.settlements.map(sc => ({
        id: sc.settlement.id,
        name: sc.settlement.name,
        cluster: sc.settlement.cluster?.name ?? "",
        zone: sc.settlement.cluster?.zone?.name ?? "",
        distanceKm: sc.distanceKm,
      })),
    },
  }));

  return NextResponse.json({ type: "FeatureCollection", features });
}
