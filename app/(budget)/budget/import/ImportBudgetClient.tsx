"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ParsedBudget } from "@/lib/budget/importTemplate";

const fmtINR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const CITY_NAMES = ["Bangalore", "Chennai", "Others"] as const;

export default function ImportBudgetClient({
  initialCity,
  partners = [],
}: {
  initialCity?: string;
  partners?: { id: string; name: string; city: string }[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedBudget | null>(null);
  const [busy, setBusy] = useState<"parse" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState<string>(
    (CITY_NAMES as readonly string[]).includes(initialCity ?? "") ? initialCity! : "Bangalore",
  );
  const [grantPartnerId, setGrantPartnerId] = useState<string>("");

  // Blank-template download (fill by hand, then import above).
  const [blankName, setBlankName] = useState("");
  const [blankCity, setBlankCity] = useState<string>(
    (CITY_NAMES as readonly string[]).includes(initialCity ?? "") ? initialCity! : "Bangalore",
  );
  const [blankHorizon, setBlankHorizon] = useState(12);
  const [blankInflation, setBlankInflation] = useState(false);

  function downloadBlank() {
    const p = new URLSearchParams({
      name: blankName.trim() || "Untitled budget",
      city: blankCity,
      horizon: String(blankHorizon),
      inflation: blankInflation ? "1" : "0",
    });
    window.location.href = `/budget/blank-template?${p.toString()}`;
  }

  async function send(commit: boolean): Promise<Response> {
    const fd = new FormData();
    fd.set("file", file!);
    if (commit) {
      fd.set("commit", "1");
      fd.set("city", city);
      if (grantPartnerId) fd.set("grantPartnerId", grantPartnerId);
    }
    return fetch("/budget/import/parse", { method: "POST", body: fd });
  }

  async function onParse() {
    if (!file) return;
    setBusy("parse"); setError(null); setPreview(null);
    try {
      const res = await send(false);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not read the file."); return; }
      const p = json.preview as ParsedBudget;
      setPreview(p);
      // Default the city to the query param, else the parsed file's city.
      if (!(CITY_NAMES as readonly string[]).includes(initialCity ?? "") && p.city) setCity(p.city);
    } catch { setError("Upload failed — please try again."); }
    finally { setBusy(null); }
  }

  const cityPartners = partners.filter((p) => p.city === city);

  async function onCommit() {
    if (!file) return;
    setBusy("commit"); setError(null);
    try {
      const res = await send(true);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not create the budget."); return; }
      router.push(`/budget/${json.id}`);
    } catch { setError("Could not create the budget — please try again."); }
    finally { setBusy(null); }
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Download a blank template to fill by hand */}
      <details className="rounded-xl border border-stone-200 bg-stone-50 p-5">
        <summary className="cursor-pointer text-sm font-medium text-stone-700">
          Need a blank template? Download one to fill by hand
        </summary>
        <p className="text-xs text-stone-500 mt-2">
          Produces an empty copy of this template (green rows in every section) with no cost-registry
          basis. Fill in your own lines, then upload it above. Rows you leave empty are ignored on import.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-stone-500 flex-1 min-w-[12rem]">Budget name
            <input value={blankName} onChange={e => setBlankName(e.target.value)} placeholder="e.g. Special project 2026"
              className="mt-1 block w-full rounded border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-stone-500">City
            <select value={blankCity} onChange={e => setBlankCity(e.target.value)} className="mt-1 block rounded border border-stone-300 px-2 py-1.5 text-sm">
              {CITY_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-stone-500">Horizon (months)
            <input type="number" min={1} max={60} value={blankHorizon}
              onChange={e => setBlankHorizon(Math.min(60, Math.max(1, Math.round(Number(e.target.value) || 12))))}
              className="mt-1 block w-24 rounded border border-stone-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-stone-500 flex items-center gap-1.5 pb-2">
            <input type="checkbox" checked={blankInflation} onChange={e => setBlankInflation(e.target.checked)} />
            Show inflation table
          </label>
          <button onClick={downloadBlank}
            className="text-sm bg-stone-900 text-white px-4 py-2 rounded-lg hover:bg-stone-700">
            Download blank template
          </button>
        </div>
      </details>

      {/* Upload */}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(null); }}
            className="text-sm"
          />
          <button
            onClick={onParse}
            disabled={!file || busy !== null}
            className="text-sm bg-stone-900 text-white px-4 py-2 rounded-lg hover:bg-stone-700 disabled:opacity-50"
          >
            {busy === "parse" ? "Reading…" : "Read file"}
          </button>
        </div>
        <p className="text-xs text-stone-400 mt-2">
          Only .xlsx files exported from this app can be imported (they carry the hidden data this needs).
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">{error}</div>
      )}

      {/* Preview */}
      {preview && (
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-stone-900">{preview.name}</h2>
              <span className="text-lg font-semibold text-stone-900 tabular-nums">{fmtINR(preview.grandTotal)}</span>
            </div>
            <div className="mt-1 text-xs text-stone-500 flex flex-wrap gap-x-4 gap-y-1">
              <span>City: {preview.city}</span>
              <span>Horizon: {preview.horizonMonths} mo ({preview.years}y)</span>
              <span>Domains: {preview.domains.length ? preview.domains.join(", ") : "all"}</span>
              <span>Inflation: {preview.applyInflation ? `on (${preview.inflationPct.Salary}/${preview.inflationPct.Other}/${preview.inflationPct.Nil}%)` : "off"}</span>
              <span>{preview.lines.length} lines · {preview.lines.filter(l => l.edited).length} edited</span>
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs space-y-0.5">
              {preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <div className="max-h-[460px] overflow-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-stone-50 text-stone-500 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Description</th>
                  <th className="text-left font-medium px-2 py-2">Section</th>
                  <th className="text-right font-medium px-2 py-2">Y1 Units</th>
                  <th className="text-right font-medium px-2 py-2">Y1 Unit cost</th>
                  <th className="text-right font-medium px-4 py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {preview.lines.map((l, i) => {
                  const total = l.y1Total + l.y2Total + l.y3Total + l.y4Total + l.y5Total;
                  return (
                    <tr key={i} className={l.edited ? "bg-amber-50/40" : ""}>
                      <td className="px-4 py-1.5">
                        {l.description}
                        {l.edited && <span className="ml-2 text-[10px] text-amber-600 align-middle">edited</span>}
                      </td>
                      <td className="px-2 py-1.5 text-stone-500 text-xs">{l.section}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.y1Units || ""}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.y1UnitCost ? fmtINR(l.y1UnitCost) : ""}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{fmtINR(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-4 border-t border-stone-100 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-stone-500">City
                <select value={city} onChange={e => { setCity(e.target.value); setGrantPartnerId(""); }} className="mt-1 block rounded border border-stone-300 px-2 py-1.5 text-sm">
                  {CITY_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="text-xs text-stone-500">Partner
                <select value={grantPartnerId} onChange={e => setGrantPartnerId(e.target.value)} className="mt-1 block rounded border border-stone-300 px-2 py-1.5 text-sm min-w-[10rem]">
                  <option value="">Unassigned</option>
                  {cityPartners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            <button
              onClick={onCommit}
              disabled={busy !== null}
              className="text-sm bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 shrink-0"
            >
              {busy === "commit" ? "Creating…" : "Create budget →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
