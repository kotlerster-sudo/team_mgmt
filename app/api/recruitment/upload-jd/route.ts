import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";

// Blob-client token for JD source docs. Same pattern as upload-cv/route.ts —
// the browser uploads straight to Blob so we sidestep Vercel's 4.5 MB
// function-body cap (see [[recruitment_page]] on the 4.5 MB gotcha).
//
// Files land in recruitment/jd-tmp/ initially. When the JD is created, the
// extract endpoint stashes the URL on RecruitmentJob.sourceDocUrl and the row
// keeps it as provenance. If the user abandons the flow, the blob is orphaned
// (cheap; we can add a sweeper later).
//
// Gated on recruitment.create — same as the JD create endpoint.

const PREFIX = "recruitment/jd-tmp/";
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    return NextResponse.json(
      await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname) => {
          const session = await auth();
          const ctx = await buildRbacContext(session, { req: request });
          if (!(await can(ctx, "recruitment", "create"))) throw new Error("Not found");
          if (!pathname.startsWith(PREFIX)) throw new Error("Invalid upload path");
          return {
            allowedContentTypes: [
              "application/pdf",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "application/msword",
              "image/png",
              "image/jpeg",
              "image/webp",
            ],
            maximumSizeInBytes: MAX_BYTES,
            addRandomSuffix: true,
          };
        },
        onUploadCompleted: async () => {},
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
