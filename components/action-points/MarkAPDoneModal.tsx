"use client";

/**
 * MarkAPDoneModal — closure note + optional photo proof for an ActionPoint.
 *
 * Photo proof is uploaded via /api/upload (the shared Blob endpoint) and the
 * returned URL is stored on the AP. We pass the AP's pitstopId so the
 * Attachment row anchors to the same Pitstop for a clean trail; the AP itself
 * holds the canonical reference via `closureProofUrl`.
 */

import { useState, useRef } from "react";
import { X, Loader2, Paperclip, Trash2 } from "lucide-react";
import type { ActionPoint } from "./types";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";

export function MarkAPDoneModal({
  ap, onClose, onDone,
}: {
  ap: ActionPoint;
  onClose: () => void;
  onDone: (next: ActionPoint) => void;
}) {
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadProof(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Anchor to the pitstop so the Attachment row has a sensible parent. An
      // ad-hoc task has none; /api/upload leaves the parent unset in that case.
      if (ap.pitstopId) fd.append("pitstopId", ap.pitstopId);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        setErr((await res.json().catch(() => ({})))?.error ?? "Upload failed");
        setUploading(false);
        return;
      }
      const att = await res.json();
      setProofUrl(att.url);
      setProofName(att.name ?? file.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setErr(null);
    const res = await fetch(`/api/action-points/${ap.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        closureNote: note.trim() || undefined,
        closureProofUrl: proofUrl ?? undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({})))?.error ?? "Couldn't close action point");
      return;
    }
    onDone(await res.json());
  }

  return (
    <SurfaceProvider id="action_point.mark_done_modal">
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-900">Mark action point done</h2>
          <button onClick={onClose} aria-label="Close"><X className="w-4 h-4 text-stone-400" /></button>
        </div>

        <p className="text-sm text-stone-700 leading-snug mb-4">{ap.title}</p>
        {ap.partnerStaffLabel && (
          <p className="text-xs text-violet-700 mb-3">↪ {ap.partnerStaffLabel}</p>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Closure note <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="E.g. fire blanket delivered to Sanjay Gandhinagar on 26 May"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Proof <span className="text-stone-400 font-normal">(optional photo / file)</span>
            </label>
            {proofUrl ? (
              <div className="flex items-center gap-2 px-3 py-2 border border-stone-200 rounded-lg bg-stone-50">
                <Paperclip className="w-4 h-4 text-stone-400 flex-shrink-0" />
                <a href={proofUrl} target="_blank" rel="noopener" className="text-xs text-sky-600 truncate flex-1 hover:underline">
                  {proofName ?? "Attachment"}
                </a>
                <button
                  type="button"
                  onClick={() => { setProofUrl(null); setProofName(null); }}
                  className="p-1 text-stone-400 hover:text-red-500 rounded"
                  aria-label="Remove proof"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="w-full px-3 py-2 text-xs font-medium text-stone-600 bg-white hover:bg-stone-50 border border-stone-200 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</> : <><Paperclip className="w-3.5 h-3.5" /> Attach</>}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadProof(f); e.target.value = ""; }}
                />
              </>
            )}
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || uploading}
              className="px-3 py-2 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 rounded-lg"
            >
              {submitting ? "Saving…" : "Mark done"}
            </button>
          </div>
        </div>
      </div>
    </div>
    </SurfaceProvider>
  );
}
