import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";

const PREFIX = "recruitment/cv-tmp/";
const MAX_BYTES = 15 * 1024 * 1024;

// Issues a client token so the browser uploads the CV straight to Blob.
// Routing the file through this function instead would cap it at Vercel's
// 4.5 MB request-body limit, which scanned CVs routinely exceed.
//
// Candidate PII — private store, super-admin only, deleted after doc generation.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    return NextResponse.json(
      await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname) => {
          const session = await auth();
          if (!isSuperAdmin(session)) throw new Error("Not found");
          // generate/route.ts trusts this prefix when validating CV references.
          if (!pathname.startsWith(PREFIX)) throw new Error("Invalid upload path");
          return {
            allowedContentTypes: ["application/pdf"],
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
