import Link from 'next/link';
import { FileText, PenLine, Settings, ClipboardCheck, Workflow } from 'lucide-react';

export default function GrantNotesHomePage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-stone-900">Review Portal</h1>
        <p className="text-sm text-stone-500 mt-1">Document drafting, editing, and leadership review</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link href="/grant-notes/draft"
          className="flex flex-col gap-3 p-5 bg-white border border-stone-200 rounded-xl hover:border-sky-300 hover:shadow-sm transition-all">
          <div className="w-9 h-9 rounded-lg bg-sky-50 flex items-center justify-center">
            <PenLine className="w-4 h-4 text-sky-600" />
          </div>
          <div>
            <p className="font-medium text-stone-900">Draft a note</p>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">Upload org documents and generate a grant note or programme design with Claude.</p>
          </div>
        </Link>

        <Link href="/grant-notes/notes"
          className="flex flex-col gap-3 p-5 bg-white border border-stone-200 rounded-xl hover:border-sky-300 hover:shadow-sm transition-all">
          <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center">
            <FileText className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <p className="font-medium text-stone-900">Grant notes</p>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">Review submitted grant notes. Comment, approve, or reject. Download as Word.</p>
          </div>
        </Link>

        <Link href="/due-diligence"
          className="flex flex-col gap-3 p-5 bg-white border border-stone-200 rounded-xl hover:border-sky-300 hover:shadow-sm transition-all">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
            <ClipboardCheck className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="font-medium text-stone-900">Due Diligence</p>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">Progressive org data collection — profile, compliance, financials, programme design.</p>
          </div>
        </Link>

        <Link href="/approvals"
          className="flex flex-col gap-3 p-5 bg-white border border-stone-200 rounded-xl hover:border-emerald-300 hover:shadow-sm transition-all">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
            <Workflow className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="font-medium text-stone-900">Approvals</p>
            <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">Structured wizard: partner data → validate → judgement → finance → budget → deck. No free-form editing.</p>
          </div>
        </Link>

        <Link href="/grant-notes/admin"
          className="flex flex-col gap-3 p-5 bg-white border border-stone-200 rounded-xl hover:border-stone-300 hover:shadow-sm transition-all">
          <div className="w-9 h-9 rounded-lg bg-stone-100 flex items-center justify-center">
            <Settings className="w-4 h-4 text-stone-500" />
          </div>
          <div>
            <p className="font-medium text-stone-700">Admin</p>
            <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">Edit section content, manage reviewers, update the Claude rulebook.</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
