"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { FileUp, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";

type AddPhase = "idle" | "uploading" | "scouting";
type Mode = "append" | "regenerate";

export default function ScoutingDayActions({
  slug,
  canAddCvs,
  canDelete,
  addDisabledReason,
  deleteDisabledReason,
}: {
  slug: string;
  canAddCvs: boolean;
  canDelete: boolean;
  addDisabledReason: string;
  deleteDisabledReason: string;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const doDelete = async () => {
    if (!confirm("Delete this scouting desk? The HTML, its DB row and all team scores/notes will be removed. This cannot be undone.")) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/recruitment/${slug}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => null))?.error) || "Delete failed");
      router.push("/recruitment");
      router.refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {canAddCvs ? (
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
        >
          <Plus className="w-3.5 h-3.5" /> Add CVs
        </button>
      ) : addDisabledReason ? (
        <span className="text-[11px] text-stone-400" title={addDisabledReason}>+ Add CVs (unavailable)</span>
      ) : null}
      {canDelete ? (
        <button
          onClick={doDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-stone-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          Delete
        </button>
      ) : deleteDisabledReason ? (
        <span className="text-[11px] text-stone-400" title={deleteDisabledReason}>Delete (unavailable)</span>
      ) : null}
      {deleteError && <span className="text-[11px] text-red-500">{deleteError}</span>}

      {addOpen && <AddCvsModal slug={slug} onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); router.refresh(); }} />}
    </div>
  );
}

// ── Add-CVs modal ──────────────────────────────────────────────────────────

function AddCvsModal({
  slug, onClose, onDone,
}: {
  slug: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<Mode>("append");
  const [phase, setPhase] = useState<AddPhase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle";

  const submit = async () => {
    if (busy) return;
    // Append requires new CVs; regenerate can run with zero (fresh axes on
    // existing pool). API validates too.
    if (mode === "append" && files.length === 0) return;
    setError(null);
    try {
      setPhase("uploading");
      const cvs: { url: string; name: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          throw new Error(`Only PDF CVs are supported — "${file.name}" is not a PDF`);
        }
        if (file.size > 15 * 1024 * 1024) {
          throw new Error(`"${file.name}" is too large (max 15 MB)`);
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const blob = await upload(`recruitment/cv-tmp/${safeName}`, file, {
          access: "private",
          contentType: "application/pdf",
          handleUploadUrl: "/api/recruitment/upload-cv",
          multipart: true,
          onUploadProgress: ({ percentage }) =>
            setProgress(`Uploading CV ${i + 1} of ${files.length} — ${Math.round(percentage)}%`),
        });
        cvs.push({ url: blob.url, name: file.name });
      }

      setPhase("scouting");
      setProgress(mode === "append"
        ? "Scoring the new candidates on the existing pool's axes…"
        : "Re-scouting the full pool with fresh axes…");
      const endpoint = mode === "append"
        ? `/api/recruitment/${slug}/add-cvs`
        : `/api/recruitment/${slug}/regenerate`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvs }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || (mode === "append" ? "Add failed" : "Regenerate failed"));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("idle");
      setProgress("");
    }
  };

  const submitLabel =
    mode === "append"
      ? "Score & append"
      : files.length > 0
        ? "Regenerate with all candidates"
        : "Regenerate on existing pool";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-lg space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-sky-500" />
          <p className="text-sm font-medium text-stone-800">Add CVs to this scouting desk</p>
          <button onClick={onClose} disabled={busy} className="ml-auto p-1 text-stone-400 hover:text-stone-600 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="space-y-2">
          <label className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer ${mode === "append" ? "border-sky-300 bg-sky-50/40" : "border-stone-200 hover:border-stone-300"}`}>
            <input type="radio" name="mode" checked={mode === "append"} onChange={() => setMode("append")} disabled={busy} className="mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-stone-800">Append</p>
              <p className="text-[11px] text-stone-500">Score the new CVs on this desk&apos;s existing axes and slot them in beside the current pool — headlines and prior candidates stay untouched.</p>
            </div>
          </label>
          <label className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer ${mode === "regenerate" ? "border-amber-300 bg-amber-50/40" : "border-stone-200 hover:border-stone-300"}`}>
            <input type="radio" name="mode" checked={mode === "regenerate"} onChange={() => setMode("regenerate")} disabled={busy} className="mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-stone-800">Regenerate with all candidates</p>
              <p className="text-[11px] text-stone-500">Re-scout the full pool from scratch — fresh axes, headlines and re-scored existing candidates (using their prior scout notes as evidence, since original CVs aren&apos;t kept). Team scores/notes survive because candidate ids are preserved.</p>
            </div>
          </label>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={busy}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="hidden"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-600 hover:border-sky-300 hover:text-sky-700 transition-colors disabled:opacity-50"
        >
          <FileUp className="w-4 h-4" />
          {files.length > 0
            ? `${files.length} CV${files.length > 1 ? "s" : ""} selected`
            : mode === "regenerate"
              ? "Select CV PDFs (optional)"
              : "Select CV PDFs"}
        </button>
        {files.length > 0 && (
          <p className="text-xs text-stone-400 truncate">{files.map((f) => f.name).join(" · ")}</p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          {!busy && (
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg text-stone-500 hover:bg-stone-100">Cancel</button>
          )}
          <button
            onClick={submit}
            disabled={busy || (mode === "append" && files.length === 0)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${mode === "regenerate" ? "bg-amber-600 hover:bg-amber-700" : "bg-sky-600 hover:bg-sky-700"}`}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {busy ? progress : submitLabel}
          </button>
        </div>
        {phase === "scouting" && (
          <p className="text-[11px] text-stone-400">Keep this tab open — this takes a few minutes.</p>
        )}
      </div>
    </div>
  );
}
