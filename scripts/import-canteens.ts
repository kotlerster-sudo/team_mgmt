/**
 * scripts/import-canteens.ts
 *
 * Imports Indira Canteen locations from a Karnataka govt KML export into the
 * IndiraCanteen table, then haversine-tags them to nearby settlements
 * (SettlementCanteen). Mirrors scripts/import-schools.ts.
 *
 * The govt KML stores attributes as <SimpleData name="..."> pairs (not <name>):
 *   Indira_CanteenName  → canteen name
 *   KGISCode            → stable external id (unique)
 *   <Point><coordinates>lng,lat</coordinates>
 *
 * Usage:
 *   npx tsx scripts/import-canteens.ts --kml=path/to/canteens.kml [--maxKm=4]
 *
 * To re-tag without reimporting:
 *   npx tsx scripts/import-canteens.ts --retag [--maxKm=4]
 */

import fs from "fs";
import path from "path";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 1 });
const prisma = new PrismaClient({ adapter });

const KML_ARG = process.argv.find(a => a.startsWith("--kml="))?.replace("--kml=", "");
const MAX_KM = parseFloat(process.argv.find(a => a.startsWith("--maxKm="))?.replace("--maxKm=", "") ?? "4");
const RETAG_ONLY = process.argv.includes("--retag");

interface CanteenPoint {
  name: string;
  lat: number;
  lng: number;
  kgisCode?: string;
}

// ── KML parser ────────────────────────────────────────────────────────────────

function simpleData(block: string, field: string): string | undefined {
  const m = block.match(new RegExp(`<SimpleData name="${field}">\\s*([\\s\\S]*?)\\s*</SimpleData>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : undefined;
}

function parseKML(kmlContent: string): CanteenPoint[] {
  const canteens: CanteenPoint[] = [];

  const placemarkRe = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let pm: RegExpExecArray | null;

  while ((pm = placemarkRe.exec(kmlContent)) !== null) {
    const block = pm[1];
    if (!/<Point/i.test(block)) continue;

    // Name: prefer the schema field, fall back to a plain <name> tag
    const name =
      simpleData(block, "Indira_CanteenName") ??
      block.match(/<name>\s*([\s\S]*?)\s*<\/name>/i)?.[1]
        ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    if (!name) continue;

    const coordMatch = block.match(/<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/i);
    if (!coordMatch) continue;
    const parts = coordMatch[1].trim().split(/[\s,]+/);
    if (parts.length < 2) continue;
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) continue;

    const kgisCode = simpleData(block, "KGISCode");

    canteens.push({ name, lat, lng, kgisCode });
  }

  return canteens;
}

// ── Haversine distance (km) ───────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Tagging logic ─────────────────────────────────────────────────────────────

async function retag(maxKm: number) {
  const canteens = await prisma.indiraCanteen.findMany();
  const settlements = await prisma.settlement.findMany({
    where: { deletedAt: null, centroidLat: { not: null }, centroidLng: { not: null } },
    select: { id: true, name: true, centroidLat: true, centroidLng: true },
  });

  console.log(`\nTagging: ${canteens.length} canteens × ${settlements.length} settlements (maxKm=${maxKm})`);

  const deleted = await prisma.settlementCanteen.deleteMany();
  console.log(`  Cleared ${deleted.count} existing links`);

  const toCreate: { id: string; settlementId: string; canteenId: string; distanceKm: number }[] = [];
  for (const canteen of canteens) {
    for (const s of settlements) {
      const d = haversine(canteen.lat, canteen.lng, s.centroidLat!, s.centroidLng!);
      if (d <= maxKm) {
        toCreate.push({
          id: crypto.randomUUID(),
          settlementId: s.id,
          canteenId: canteen.id,
          distanceKm: Math.round(d * 1000) / 1000,
        });
      }
    }
  }

  const BATCH = 200;
  for (let i = 0; i < toCreate.length; i += BATCH) {
    await prisma.settlementCanteen.createMany({ data: toCreate.slice(i, i + BATCH), skipDuplicates: true });
  }

  console.log(`  Created ${toCreate.length} settlement-canteen links`);
  return toCreate.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!RETAG_ONLY) {
    if (!KML_ARG) {
      console.error("Usage: npx tsx scripts/import-canteens.ts --kml=path/to/canteens.kml [--maxKm=4]");
      console.error("       npx tsx scripts/import-canteens.ts --retag [--maxKm=4]");
      process.exit(1);
    }

    const kmlPath = path.resolve(process.cwd(), KML_ARG);
    if (!fs.existsSync(kmlPath)) {
      console.error(`KML file not found: ${kmlPath}`);
      process.exit(1);
    }

    console.log(`\nParsing KML: ${kmlPath}`);
    const kml = fs.readFileSync(kmlPath, "utf-8");
    const canteens = parseKML(kml);
    console.log(`Found ${canteens.length} canteen Placemarks`);

    if (canteens.length === 0) {
      console.error("No canteens found in KML. Check the file format.");
      process.exit(1);
    }

    let inserted = 0, upserted = 0;
    for (const c of canteens) {
      if (c.kgisCode) {
        await prisma.indiraCanteen.upsert({
          where: { kgisCode: c.kgisCode },
          create: { name: c.name, lat: c.lat, lng: c.lng, kgisCode: c.kgisCode },
          update: { name: c.name, lat: c.lat, lng: c.lng },
        });
        upserted++;
      } else {
        await prisma.indiraCanteen.create({
          data: { name: c.name, lat: c.lat, lng: c.lng },
        });
        inserted++;
      }
    }

    console.log(`  Inserted: ${inserted}  Upserted: ${upserted}`);
  }

  await retag(MAX_KM);

  const canteenCount = await prisma.indiraCanteen.count();
  const linkCount = await prisma.settlementCanteen.count();
  console.log(`\nDone. Total canteens in DB: ${canteenCount}  Total links: ${linkCount}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
