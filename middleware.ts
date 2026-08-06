import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  // Both are reached while signed out — by someone who has lost their password,
  // and by an invited grantee who has never had one.
  "/forgot-password",
  "/reset-password",
  "/api/auth/",
  "/api/register",
  "/api/cron/",
  "/api/debug/",
  // Vercel Blob client uploader. The endpoint itself uses handleUpload from
  // @vercel/blob/client, which signs short-lived tokens server-side and
  // restricts allowed content types + max size. Safe to expose without
  // NextAuth gating.
  "/api/review/blob-upload",
  "/_next",
  "/favicon",
  "/manifest",
  "/icon-",
  "/icons",
  "/sw.js",
  "/.well-known/",
  "/data/",
  "/index.html",
  "/welcome.html",
  "/workshop-agenda.html",
  "/pitstops-training.html",
  "/pitstops-presentation.html",
  "/seeding-fellowships.html",
  "/seeding-decks.html",
  "/workshop/",
  "/training/",
  // Public model viewer — opt-in per instance via ModelInstance.publicSlug.
  // Read-only sim; sliders are local state, never written back.
  "/models-public/",
  // Public school plan viewer — opt-in per plan via SchoolPlan.publicSlug.
  // Read-only; sensitive fields (budget, salaries, phones) redacted.
  "/schools-public/",
];

// Paths a "partner" role may reach: their budget home, any budget's reports
// subtree (page + the report server-action POSTs land on the same path), a
// shared draft budget, the matching report APIs, plus account/notification
// self-service.
function partnerAllowedPath(pathname: string): boolean {
  if (pathname === "/budget" || pathname === "/budget/") return true;
  if (pathname === "/budget/account") return true;
  if (/^\/budget\/[^/]+\/reports(\/[^/]*)?$/.test(pathname)) return true;
  // A draft the lead shared for their input. Server actions POST to the same path.
  if (/^\/budget\/[^/]+\/draft$/.test(pathname)) return true;
  if (/^\/api\/budget\/[^/]+\/reports\//.test(pathname)) return true;
  if (pathname === "/api/budget/parse-bank-statement") return true;
  if (pathname === "/api/budget/declaration-upload") return true;
  if (pathname.startsWith("/settings/account")) return true;
  if (pathname.startsWith("/api/account")) return true;
  if (pathname.startsWith("/api/notifications")) return true;
  // Approvals wizard — partner-lane surfaces. Per-assembly ownership is
  // enforced in the routes themselves via getAssemblyForPartnerUser.
  if (pathname === "/partner/approvals") return true;
  if (/^\/partner\/approvals\/[^/]+$/.test(pathname)) return true;
  if (/^\/api\/approvals\/[^/]+\/partner(\/[^/]*)?$/.test(pathname)) return true;
  return false;
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip auth for public routes
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Not logged in — redirect HTML routes to login, return JSON 401 for API routes
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(loginUrl);
  }

  const role = (token as { role?: string }).role;
  const method = req.method;
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const isApiRoute = pathname.startsWith("/api/");

  // partner (external grantee): confined to their budget home + their reports
  // subtree and the account/notification APIs. Everything else → /budget. This
  // is the coarse choke point; per-budget ownership is enforced in the pages
  // and server actions via GrantPartnerUser.
  if (role === "partner") {
    if (!partnerAllowedPath(pathname)) {
      if (isApiRoute) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      return NextResponse.redirect(new URL("/budget", req.url));
    }
  }

  // budget-admin: budget + seeding sections, the portal chooser, and account
  // settings. Everything else redirects to the portal (Budget + Seeding tiles).
  if (role === "budget-admin") {
    const BUDGET_PREFIXES = ["/portal", "/budget", "/seeding", "/admin", "/api/budget", "/api/admin/budget", "/settings", "/api/account"];
    if (!BUDGET_PREFIXES.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
  }

  if (role === "viewer" && isMutation && isApiRoute) {
    const allowed = [
      "/api/account/password",
      "/api/account/external-calendar",
      "/api/notifications",
      "/api/account",
    ];
    if (!allowed.some((p) => pathname.startsWith(p))) {
      return NextResponse.json({ error: "Viewers cannot make changes." }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-|icons|sw.js|\\.well-known|data).*)",
  ],
};
