import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import ImportBudgetClient from "./ImportBudgetClient";
import { listGrantingUnits } from "@/lib/budget/grantingUnits";

export default async function ImportBudgetPage({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const initialCity = (await searchParams).city;

  const [partners, units] = await Promise.all([
    prisma.grantPartner.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true },
    }),
    listGrantingUnits(),
  ]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-2 text-sm text-stone-500 mb-1">
        <Link href={`/budget/new${initialCity ? `?city=${encodeURIComponent(initialCity)}` : ""}`} className="hover:underline">← New budget</Link>
      </div>
      <h1 className="text-2xl font-semibold text-stone-900">Import budget from Excel</h1>
      <p className="text-sm text-stone-500 mt-1">
        Upload a filled copy of a template that was <span className="font-medium">exported from this app</span>.
        We&apos;ll read the line items, units and costs you entered and pre-fill a new draft budget.
      </p>
      <ImportBudgetClient initialCity={initialCity} units={units.map((u) => ({ id: u.id, name: u.name }))} partners={partners} />
    </div>
  );
}
