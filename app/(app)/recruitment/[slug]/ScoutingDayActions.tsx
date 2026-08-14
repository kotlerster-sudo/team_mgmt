"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { FileUp, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";

type AddPhase = "idle" | "uploading" | "scouting";

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
  const [phase, setPhase] = useState<AddPhase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle";

  const submit = async () => {
    if (files.length === 0 || busy) return;
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
      setProgress("Scoring the new candidates on the existing pool's axes…");
      const res = await fetch(`/api/recruitment/${slug}/add-cvs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvs }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Add failed");
      // Success — reload the iframe by refreshing the page.
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("idle");
      setProgress("");
    }
  };

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
        <p className="text-[11px] text-stone-500">
          The new candidates will be scored on the desk&apos;s existing radar axes so they slot in beside the current pool.
          Headlines and cross-pool observations from the original run are preserved.
        </p>
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
          {files.length > 0 ? `${files.length} CV${files.length > 1 ? "s" : ""} selected` : "Select CV PDFs"}
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
            disabled={busy || files.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {busy ? progress : "Score & append"}
          </button>
        </div>
        {phase === "scouting" && (
          <p className="text-[11px] text-stone-400">Keep this tab open — this takes a few minutes.</p>
        )}
      </div>
    </div>
  );
}
