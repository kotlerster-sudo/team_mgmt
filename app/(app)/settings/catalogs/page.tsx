"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronLeft, Plus, Repeat, Layers } from "lucide-react";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

type CatalogRow = {
  id: string;
  slug: string;
  name: string;
  needsDomain: string | null;
  categories: { key: string; label: string; items: unknown[] }[];
  defaultCadenceCount: number | null;
  defaultCadencePeriod: string | null;
  isActive: boolean;
};

function cadenceLabel(c: CatalogRow): string | null {
  if (!c.defaultCadenceCount || !c.defaultCadencePeriod) return null;
  return `${c.defaultCadenceCount}× / ${c.defaultCadencePeriod}`;
}

export default function CatalogsListPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super-admin";
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/catalogs")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (session && !isAdmin) router.replace("/settings");
  }, [session, isAdmin, router]);

  if (!isAdmin) return null;

  return (
    <SurfaceProvider id="settings.catalogs">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/settings" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-stone-900">Visit Catalogs</h1>
            <p className="text-xs text-stone-400">
              Domain-default categories &amp; cadence for live centres. Seeded onto a centre when it goes live.
            </p>
          </div>
          <Link
            href="/settings/catalogs/new"
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> New catalog
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-stone-400 text-center py-10">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-stone-400 italic text-center py-10">
            No catalogs yet. Create one per programme domain.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((c) => (
              <Link
                key={c.id}
                href={`/settings/catalogs/${c.id}`}
                className={`flex items-center gap-3 px-4 py-3 border rounded-xl bg-white hover:border-stone-300 transition-colors ${
                  c.isActive ? "border-stone-200" : "border-stone-200 opacity-60"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-stone-800 truncate">{c.name}</span>
                    {c.needsDomain && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-500 rounded-full shrink-0">
                        {c.needsDomain}
                      </span>
                    )}
                    {!c.isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full shrink-0">
                        inactive
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-400 font-mono">{c.slug}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-stone-400 shrink-0">
                  <span className="flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5" /> {c.categories?.length ?? 0}
                  </span>
                  {cadenceLabel(c) && (
                    <span className="flex items-center gap-1 text-sky-600">
                      <Repeat className="w-3.5 h-3.5" /> {cadenceLabel(c)}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </SurfaceProvider>
  );
}
