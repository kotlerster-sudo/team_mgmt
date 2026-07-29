import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";

// Temp holding area for candidate CV PDFs before doc generation. Candidate
// PII — private store, super-admin only, deleted after the doc is generated.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF CVs are supported" }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 413 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const blob = await put(`recruitment/cv-tmp/${safeName}`, file, {
    access: "private",
    addRandomSuffix: true,
  });
  return NextResponse.json({ url: blob.url, name: file.name });
}
