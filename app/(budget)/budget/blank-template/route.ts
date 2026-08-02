import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { buildBlankBudgetWorkbook } from "@/lib/budget/blankTemplate";
import { grantingUnitNames } from "@/lib/budget/grantingUnits";

// GET a blank APF template (empty green rows per section) to fill and re-import.
//   ?name= &city= &horizon= &inflation=1
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

  const q = req.nextUrl.searchParams;
  const name = (q.get("name") ?? "").trim() || "Untitled budget";
  const cityRaw = (q.get("city") ?? "").trim();
  const city = (await grantingUnitNames()).includes(cityRaw) ? cityRaw : "Bangalore";
  const horizonMonths = Math.min(60, Math.max(1, Math.round(Number(q.get("horizon")) || 12)));
  const applyInflation = q.get("inflation") === "1";

  const buffer = await buildBlankBudgetWorkbook({ name, city, horizonMonths, applyInflation });

  const safeName = name.replace(/[^a-z0-9]/gi, "_").substring(0, 40) || "blank";
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}_blank_template.xlsx"`,
    },
  });
}
