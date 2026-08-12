"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  Target, Search, LogOut, Bell, Settings, Users, GanttChartSquare,
  CalendarClock, MoreHorizontal, X, BookOpen, ClipboardList, MapPin,
  CalendarRange, HelpCircle, BarChart3, MessageSquare, LayoutGrid, Route, TrendingUp,
  Layers, Library, Calculator, GraduationCap, UserSearch, Radar, Compass,
} from "lucide-react";
import Avatar from "@/components/Avatar";
import PWAInstallButton from "@/components/PWAInstallButton";

// Routes that belong to the Operations world
const OPERATIONS_ROUTES = ["/field", "/operations", "/home", "/activities", "/visits", "/threads", "/notifications"];

interface User {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export default function AppNav({
  user, unreadCount: initialUnreadCount, isAdmin, isViewer, designation, allowedNavHrefs, fieldEnabled,
}: {
  user: User;
  unreadCount: number;
  isAdmin?: boolean;
  isViewer?: boolean;
  designation?: string;
  /** Show the /field entry (RP surface, dogfood-gated). */
  fieldEnabled?: boolean;
  /**
   * Hrefs the user is allowed to see in the Setup-mode sidebar. Computed
   * server-side in `app/(app)/layout.tsx` via `computeAllowedNavHrefs()`.
   * Empty array = no nav items (effectively logged-out). Operations-mode
   * nav (home/activities/threads/notifications) is universal and not gated.
   */
  allowedNavHrefs?: string[];
}) {
  const pathname = usePathname();
  // Supervisors (ZL/PM/Leader or admin) get the Oversight drill-down entry.
  const isSupervisor = !!isAdmin || ["ZL", "PM", "Leader"].includes(designation ?? "");
  const allowedSet = new Set(allowedNavHrefs ?? []);
  const [showMore, setShowMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  // Layout is preserved across soft navigation, so the server-rendered
  // unreadCount goes stale once the user marks notifications read. Refresh
  // it whenever the notifications subsystem dispatches `pitstop:notifications-changed`.
  useEffect(() => {
    const refresh = async () => {
      try {
        const r = await fetch("/api/notifications/unread-count");
        if (!r.ok) return;
        const data = await r.json();
        if (typeof data?.count === "number") setUnreadCount(data.count);
      } catch {}
    };
    window.addEventListener("pitstop:notifications-changed", refresh);
    return () => window.removeEventListener("pitstop:notifications-changed", refresh);
  }, []);

  // No nav on the portal landing page
  if (pathname === "/portal") return null;

  const isOperations = OPERATIONS_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
  const settingsHref = isViewer ? "/settings/language" : "/settings";

  // ── Setup nav items ────────────────────────────────────────────────────────
  // Single ordered list — visibility is decided by `allowedNavHrefs` (computed
  // server-side via RBAC `can()` + has-reports check; see `navGates.ts`).
  // Add a new entry here AND add its gate in `navGates.ts`.
  const SETUP_NAV: Array<{ href: string; icon: React.ReactNode; label: string; external?: boolean }> = [
    { href: "/dashboard",  icon: <Target className="w-3.5 h-3.5" />,           label: "Goals"          },
    { href: "/needs",      icon: <BarChart3 className="w-3.5 h-3.5" />,        label: "Field Coverage" },
    { href: "/command",    icon: <Radar className="w-3.5 h-3.5" />,            label: "Command Center" },
    { href: "/effects",    icon: <TrendingUp className="w-3.5 h-3.5" />,       label: "Effects"        },
    { href: "/programmes", icon: <Layers className="w-3.5 h-3.5" />,           label: "Programmes"     },
    { href: "/map",        icon: <MapPin className="w-3.5 h-3.5" />,           label: "Programme Map"  },
    { href: "/route",      icon: <Route className="w-3.5 h-3.5" />,            label: "Route Planner"  },
    { href: "/gantt",      icon: <GanttChartSquare className="w-3.5 h-3.5" />, label: "Gantt"          },
    { href: "/planner",    icon: <BookOpen className="w-3.5 h-3.5" />,         label: "Planner"        },
    { href: "/quarters",   icon: <CalendarRange className="w-3.5 h-3.5" />,    label: "Quarters"       },
    { href: "/models",     icon: <Calculator className="w-3.5 h-3.5" />,       label: "Models"         },
    { href: "/people",     icon: <Users className="w-3.5 h-3.5" />,            label: "People"         },
    { href: "/recruitment", icon: <UserSearch className="w-3.5 h-3.5" />,      label: "Recruitment"    },
    { href: "/standup",    icon: <ClipboardList className="w-3.5 h-3.5" />,    label: "Field Notes"    },
    { href: "/wiki",       icon: <Library className="w-3.5 h-3.5" />,          label: "Wiki"           },
    { href: "/pitstops-training.html", icon: <GraduationCap className="w-3.5 h-3.5" />, label: "Training", external: true },
    { href: settingsHref,  icon: <Settings className="w-3.5 h-3.5" />,         label: "Settings"       },
    { href: "/help",       icon: <HelpCircle className="w-3.5 h-3.5" />,       label: "Manual"         },
  ];
  // Filter by RBAC-resolved allowed set. If the server didn't pass one (e.g.
  // during error states), fall back to showing the universal subset so the
  // user is never stranded without a way out.
  const UNIVERSAL_HREFS = new Set(["/wiki", "/pitstops-training.html", settingsHref, "/help"]);
  const setupNav = allowedSet.size > 0
    ? SETUP_NAV.filter(item => allowedSet.has(item.href))
    : SETUP_NAV.filter(item => UNIVERSAL_HREFS.has(item.href));

  // ── Operations nav items ───────────────────────────────────────────────────
  const operationsNav = [
    ...(fieldEnabled ? [{ href: "/field", icon: <Compass className="w-3.5 h-3.5" />, label: "Field (beta)" }] : []),
    { href: "/operations",    icon: <LayoutGrid className="w-3.5 h-3.5" />,    label: "Operations"    },
    ...(isSupervisor ? [{ href: "/operations/oversight", icon: <Layers className="w-3.5 h-3.5" />, label: "Oversight" }] : []),
    { href: "/home",          icon: <CalendarClock className="w-3.5 h-3.5" />, label: "Home"          },
    { href: "/activities",    icon: <CalendarClock className="w-3.5 h-3.5" />, label: "Activities"    },
    { href: "/visits",        icon: <CalendarRange className="w-3.5 h-3.5" />, label: "Visit calendar"},
    { href: "/threads",       icon: <MessageSquare className="w-3.5 h-3.5" />, label: "Threads"       },
    { href: "/notifications", icon: null,                                       label: "Notifications" },
  ];

  const switchHref = "/portal";
  const switchLabel = isOperations ? "Setup" : "Operations";

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <nav className="hidden sm:flex w-52 flex-shrink-0 border-r border-stone-200 bg-white flex-col h-full">

        {/* Logo */}
        <div className="px-4 py-5 border-b border-stone-100">
          <Link href="/portal" className="flex items-center gap-2" aria-label="Home">
            <div className="w-7 h-7 rounded-lg bg-sky-500 flex items-center justify-center">
              <Target className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-stone-900 text-sm tracking-tight">Pitstop</span>
          </Link>
        </div>

        {/* Search — setup world only */}
        {!isOperations && (
          <div className="px-3 py-3 border-b border-stone-100">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("pitstop:search-open"))}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-stone-50 border border-stone-200 hover:border-stone-300 hover:bg-stone-100 transition-all text-left"
            >
              <Search className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
              <span className="flex-1 text-xs text-stone-400">Search…</span>
              <kbd className="text-[10px] text-stone-400 border border-stone-200 rounded px-1 py-0.5 bg-white font-sans">⌘K</kbd>
            </button>
          </div>
        )}

        {/* Nav links */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-0.5">

          {isOperations ? (
            <>
              {operationsNav.map(({ href, icon, label }) => (
                <NavLink key={href} href={href} active={pathname === href}>
                  {href === "/notifications" ? (
                    <div className="relative">
                      <Bell className="w-3.5 h-3.5 text-stone-500" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 flex items-center justify-center bg-sky-500 text-white text-[9px] font-bold rounded-full px-0.5">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-stone-500">{icon}</span>
                  )}
                  {label}
                </NavLink>
              ))}
            </>
          ) : (
            <>
              {setupNav.map(({ href, icon, label, external }) => (
                <NavLink key={href} href={href} active={pathname === href || pathname.startsWith(href + "/")} external={external}>
                  <span className="text-stone-500">{icon}</span>
                  {label}
                </NavLink>
              ))}
            </>
          )}

          <div className="h-px bg-stone-100 my-2" />

          {/* Switch mode */}
          <NavLink href={switchHref} active={false}>
            <LayoutGrid className="w-3.5 h-3.5 text-stone-400" />
            <span className="text-stone-400">{switchLabel}</span>
          </NavLink>

        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-stone-100">
          <PWAInstallButton />
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-stone-50 group">
            <Avatar name={user.name} image={user.image} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-stone-700 truncate">{user.name ?? user.email}</p>
              {isViewer && (
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">View only</span>
              )}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5 text-stone-400 hover:text-stone-600" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Mobile bottom nav ────────────────────────────────────────────────── */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-stone-200 flex items-stretch h-16">
        {isOperations ? (
          <>
            <MobileLink href="/operations" label="Operations" active={pathname === "/operations" || pathname.startsWith("/operations/")}>
              <LayoutGrid className="w-5 h-5" />
            </MobileLink>
            <MobileLink href="/home"       label="Home"       active={pathname === "/home"}>
              <CalendarClock className="w-5 h-5" />
            </MobileLink>
            <MobileLink href="/activities" label="Activities" active={pathname === "/activities"}>
              <CalendarClock className="w-5 h-5" />
            </MobileLink>
            <MobileLink href="/notifications" label="Alerts" active={pathname === "/notifications"}>
              <div className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 flex items-center justify-center bg-sky-500 text-white text-[9px] font-bold rounded-full px-0.5">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
            </MobileLink>
            <MobileLink href="/portal" label="Switch" active={false}>
              <LayoutGrid className="w-5 h-5" />
            </MobileLink>
          </>
        ) : (
          <>
            <MobileLink href="/dashboard" label="Goals"  active={pathname.startsWith("/dashboard") || pathname.startsWith("/goals")}>
              <Target className="w-5 h-5" />
            </MobileLink>
            <MobileLink href="/map"       label="Map"    active={pathname === "/map" || pathname.startsWith("/settlements")}>
              <MapPin className="w-5 h-5" />
            </MobileLink>
            <MobileLink href="/route"     label="Route"  active={pathname === "/route"}>
              <Route className="w-5 h-5" />
            </MobileLink>
            <MobileLink href="/standup"   label="Notes"  active={pathname === "/standup"}>
              <ClipboardList className="w-5 h-5" />
            </MobileLink>
            <MobileLink href="/notifications" label="Alerts" active={pathname === "/notifications"}>
              <div className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 flex items-center justify-center bg-sky-500 text-white text-[9px] font-bold rounded-full px-0.5">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
            </MobileLink>
            <button
              onClick={() => setShowMore(true)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${showMore ? "text-sky-600" : "text-stone-400"}`}
            >
              <MoreHorizontal className="w-5 h-5" />
              More
            </button>
          </>
        )}
      </nav>

      {/* ── Setup mobile "More" drawer ───────────────────────────────────────── */}
      {showMore && !isOperations && (
        <div className="sm:hidden fixed inset-0 z-[60]" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 flex items-center justify-between px-5 pt-4 pb-2 border-b border-stone-100">
              <p className="text-sm font-semibold text-stone-800">Menu</p>
              <button onClick={() => setShowMore(false)} className="p-1 text-stone-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto px-3 py-2 pb-8 space-y-0.5">
              {setupNav.map(({ href, icon, label, external }) => {
                const cn = `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  pathname.startsWith(href) ? "bg-sky-50 text-sky-700" : "text-stone-700 hover:bg-stone-50"
                }`;
                const inner = (
                  <>
                    <span className="text-stone-400">{icon}</span>
                    {label}
                  </>
                );
                return external ? (
                  <a key={href} href={href} onClick={() => setShowMore(false)} className={cn}>
                    {inner}
                  </a>
                ) : (
                  <Link key={href} href={href} onClick={() => setShowMore(false)} className={cn}>
                    {inner}
                  </Link>
                );
              })}
              <div className="h-px bg-stone-100 my-2" />
              <Link
                href="/portal"
                onClick={() => setShowMore(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-stone-400 hover:bg-stone-50"
              >
                <LayoutGrid className="w-5 h-5" />
                Operations
              </Link>
              <div className="px-1 mt-2">
                <PWAInstallButton />
              </div>
              <button
                onClick={() => { setShowMore(false); signOut({ callbackUrl: "/login" }); }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NavLink({ href, active, external, children }: { href: string; active: boolean; external?: boolean; children: React.ReactNode }) {
  const className = `flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
    active ? "bg-sky-50 text-sky-700 font-medium" : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
  }`;
  // Static / public assets (e.g. /pitstops-training.html) — use a plain anchor
  // so we leave the App Router shell cleanly and avoid prefetching the file.
  if (external) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function MobileLink({ href, label, active, children }: { href: string; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${active ? "text-sky-600" : "text-stone-400"}`}
    >
      {children}
      {label}
    </Link>
  );
}
