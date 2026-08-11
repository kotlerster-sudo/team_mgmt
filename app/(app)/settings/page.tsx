"use client";

import { useState, useEffect } from "react";
import { Copy, Check, RefreshCw, Users, KeyRound, CalendarDays, Target, ChevronRight, ShieldCheck, Map, MapPin, Languages, LayoutTemplate, Layers, Bell, BellOff, BellRing, Activity, Cloud, ScrollText, Briefcase, ListChecks, Network } from "lucide-react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { useSession } from "next-auth/react";
import { SurfaceProvider, useHasGrant } from "@/components/rbac/RbacProviders";

type Member = { id: string; name: string | null; email: string | null; image: string | null };

export default function SettingsPage() {
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "viewer";
  const isBudgetAdmin = session?.user?.role === "budget-admin";

  // Per-section visibility — each link is gated on the underlying RBAC permission
  // so a super-admin can hide/show settings sections per role via /settings/roles.
  // useHasGrant ignores surface restrictions so the nav link shows even if the
  // action itself is restricted to a specific surface.
  const canNeedsFormulas        = useHasGrant("needs_formula",        "update");
  const canGeography            = useHasGrant("zone",                 "update");
  const canMapFeatures          = useHasGrant("map_data",             "register_settlement");
  const canFacilityIndicators   = useHasGrant("facility_indicator",   "update");
  const canCaregiverPractices   = useHasGrant("caregiver_practice",   "update");
  const canMisProviders         = useHasGrant("mis_provider",         "update");
  const canJourneyOutcomePacks  = useHasGrant("journey_outcome_pack", "update");
  const canFacilityLayers       = useHasGrant("facility_layer",       "update");
  const canUsers                = useHasGrant("user",                 "update");
  const canRoles                = useHasGrant("role",                 "list");
  const canAuditLog             = useHasGrant("audit_log",            "list");
  const canTemplates            = useHasGrant("template",             "update");
  const canWikiStaff            = useHasGrant("wiki_staff",           "manage");
  const canInviteCode           = useHasGrant("invite_code",          "read");
  const canRotateInvite         = useHasGrant("invite_code",          "rotate");
  const canMembers              = useHasGrant("user",                 "list");
  const canExternalCalendar     = useHasGrant("calendar",             "subscribe");

  // Section headers — show only if at least one child link is visible
  const showFieldCoverageSection = canNeedsFormulas || canGeography || canMapFeatures || canFacilityIndicators || canMisProviders || canJourneyOutcomePacks;
  const showAdminSection         = canUsers || canRoles || canAuditLog || canTemplates || canWikiStaff || canFacilityLayers;
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  const [externalCalUrl, setExternalCalUrl] = useState("");
  const [calSaving, setCalSaving] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);
  const [calSuccess, setCalSuccess] = useState(false);

  const [preferredLang, setPreferredLang] = useState("en");
  const [langSaving, setLangSaving] = useState(false);
  const [langSuccess, setLangSuccess] = useState(false);

  type NotifState = "unsupported" | "denied" | "granted" | "default";
  const [notifPermission, setNotifPermission] = useState<NotifState>("default");
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const LANGS = [
    { code: "en", label: "English",   native: "English"   },
    { code: "ta", label: "Tamil",     native: "தமிழ்"    },
    { code: "kn", label: "Kannada",   native: "ಕನ್ನಡ"   },
    { code: "ml", label: "Malayalam", native: "മലയാളം"   },
    { code: "hi", label: "Hindi",     native: "हिन्दी"   },
    { code: "bn", label: "Bengali",   native: "বাংলা"    },
  ];

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNotifPermission("unsupported");
    } else {
      setNotifPermission(Notification.permission as NotifState);
    }
  }, []);

  const handleEnableNotifications = async () => {
    setNotifBusy(true);
    setNotifMsg(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      setNotifPermission(permission as NotifState);
      if (permission !== "granted") {
        setNotifMsg({ ok: false, text: "Permission not granted." });
        return;
      }
      const { publicKey } = await fetch("/api/push").then((r) => r.json());
      if (!publicKey) { setNotifMsg({ ok: false, text: "Push not configured on server." }); return; }
      const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
      const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
      const applicationServerKey = Uint8Array.from([...atob(base64)].map((c) => c.charCodeAt(0)));
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      const json = sub.toJSON();
      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setNotifMsg({ ok: true, text: "Notifications enabled." });
    } catch (err) {
      setNotifMsg({ ok: false, text: String(err) });
    } finally {
      setNotifBusy(false);
    }
  };

  useEffect(() => {
    const fetches: Promise<void>[] = [
      fetch("/api/account/language").then((r) => r.json()).then((d) => {
        if (d.lang) setPreferredLang(d.lang);
      }),
    ];
    if (!isViewer) {
      fetches.push(
        fetch("/api/account/external-calendar").then((r) => r.json()).then((d) => {
          if (d.url) setExternalCalUrl(d.url);
        }),
      );
    }
    if (canInviteCode) {
      fetches.push(
        fetch("/api/invite-code").then((r) => r.json()).then((d) => setCode(d.code)),
      );
    }
    if (canMembers) {
      fetches.push(
        fetch("/api/users").then((r) => r.json()).then(setMembers),
      );
    }
    Promise.all(fetches);
  }, [canInviteCode, canMembers, isViewer]);

  const handleSaveLang = async (lang: string) => {
    setLangSaving(true);
    setLangSuccess(false);
    await fetch("/api/account/language", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang }),
    });
    setPreferredLang(lang);
    setLangSaving(false);
    setLangSuccess(true);
    setTimeout(() => setLangSuccess(false), 2000);
  };

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRotate = async () => {
    if (!confirm("Rotate the invite code? The old code will stop working immediately.")) return;
    setRotating(true);
    const res = await fetch("/api/invite-code", { method: "POST" });
    const data = await res.json();
    setCode(data.code);
    setRotating(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (newPassword !== confirmPassword) {
      setPwError("New passwords do not match");
      return;
    }
    setPwSaving(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    setPwSaving(false);
    if (!res.ok) {
      setPwError(data.error ?? "Something went wrong");
    } else {
      setPwSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  const handleSaveCalUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setCalError(null);
    setCalSuccess(false);
    setCalSaving(true);
    const res = await fetch("/api/account/external-calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: externalCalUrl }),
    });
    const data = await res.json();
    setCalSaving(false);
    if (!res.ok) setCalError(data.error ?? "Something went wrong");
    else setCalSuccess(true);
  };

  return (
    <SurfaceProvider id="settings.index">
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {isBudgetAdmin && (
        <a href="/portal" className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-700 mb-6">← Back to portal</a>
      )}
      <h1 className="text-xl font-semibold text-stone-900 mb-8">Settings</h1>

      {/* Change Password — shown to all non-viewers */}
      {!isViewer && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-stone-400" />
            <h2 className="text-sm font-semibold text-stone-700">Change Password</h2>
          </div>
          <p className="text-xs text-stone-500 mb-4">
            Enter your current password to set a new one.
          </p>

          <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white"
            />
            <input
              type="password"
              placeholder="New password (min 8 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white"
            />

            {pwError && <p className="text-xs text-red-500">{pwError}</p>}
            {pwSuccess && <p className="text-xs text-emerald-600">Password updated successfully.</p>}

            <button
              type="submit"
              disabled={pwSaving}
              className="px-4 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              {pwSaving ? "Saving…" : "Update password"}
            </button>
          </form>
        </section>
      )}

      {/* Language — shown to everyone */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-1">
          <Languages className="w-4 h-4 text-stone-400" />
          <h2 className="text-sm font-semibold text-stone-700">My Language</h2>
        </div>
        <p className="text-xs text-stone-500 mb-4">
          Thread messages will be shown in this language. Voice messages you record will be
          translated for everyone else in their own language.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-sm">
          {LANGS.map((l) => (
            <button
              key={l.code}
              disabled={langSaving}
              onClick={() => handleSaveLang(l.code)}
              className={`flex flex-col items-start px-3 py-2.5 rounded-xl border text-left transition-colors disabled:opacity-50 ${
                preferredLang === l.code
                  ? "border-stone-800 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:border-stone-300"
              }`}
            >
              <span className="text-xs font-medium">{l.label}</span>
              <span className={`text-xs mt-0.5 ${preferredLang === l.code ? "text-stone-300" : "text-stone-400"}`}>
                {l.native}
              </span>
            </button>
          ))}
        </div>
        {langSuccess && <p className="text-xs text-emerald-600 mt-3">Language preference saved.</p>}
      </section>

      {/* Notification preferences (per-user) */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-4 h-4 text-stone-400" />
          <h2 className="text-sm font-semibold text-stone-700">Notification Preferences</h2>
        </div>
        <p className="text-xs text-stone-500 mb-3">
          Choose which channels deliver wiki digests, flag alerts, and review reminders.
        </p>
        <Link
          href="/settings/notifications"
          className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors max-w-sm"
        >
          <Bell className="w-4 h-4 text-stone-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-stone-800">My notifications</p>
            <p className="text-xs text-stone-400">In-app · Browser push · WhatsApp opt-in</p>
          </div>
          <ChevronRight className="w-4 h-4 text-stone-300" />
        </Link>
      </section>

      {/* Push Notifications */}
      {notifPermission !== "unsupported" && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-1">
            <Bell className="w-4 h-4 text-stone-400" />
            <h2 className="text-sm font-semibold text-stone-700">Push Notifications</h2>
          </div>
          <p className="text-xs text-stone-500 mb-4">
            Get notified on this device for pitstop updates, mentions, and goal changes.
          </p>
          {notifPermission === "denied" ? (
            <div className="flex items-center gap-2 text-xs text-amber-600">
              <BellOff className="w-4 h-4 shrink-0" />
              <span>Notifications are blocked. Enable them in your browser or phone settings for this site, then come back here.</span>
            </div>
          ) : notifPermission === "granted" && notifMsg?.ok ? (
            <div className="flex items-center gap-2 text-xs text-emerald-600">
              <BellRing className="w-4 h-4 shrink-0" />
              <span>Notifications enabled on this device.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {notifPermission === "granted" && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 mb-1">
                  <BellRing className="w-4 h-4 shrink-0" />
                  <span>Permission granted — tap below to re-register this device.</span>
                </div>
              )}
              <button
                onClick={handleEnableNotifications}
                disabled={notifBusy}
                className="flex items-center gap-2 self-start px-4 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50"
              >
                <Bell className="w-4 h-4" />
                {notifBusy ? "Setting up…" : notifPermission === "granted" ? "Re-register this device" : "Enable notifications"}
              </button>
              {notifMsg && !notifMsg.ok && (
                <p className="text-xs text-red-500">{notifMsg.text}</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Field Coverage — visible if user has any sub-permission */}
      {showFieldCoverageSection && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-stone-700 mb-1">Field Coverage</h2>
          <p className="text-xs text-stone-500 mb-3">Configure target formulas and entitlement schemes.</p>
          <div className="space-y-2">
            {canNeedsFormulas && (
              <Link
                href="/settings/needs"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Target className="w-4 h-4 text-sky-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Formulas &amp; Schemes</p>
                  <p className="text-xs text-stone-400">Target denominators · Entitlement scheme list</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canGeography && (
              <Link
                href="/settings/geography"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Map className="w-4 h-4 text-sky-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Geography</p>
                  <p className="text-xs text-stone-400">Zones · clusters · settlements</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canMapFeatures && (
              <Link
                href="/settings/map-features"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Map className="w-4 h-4 text-indigo-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Map Features</p>
                  <p className="text-xs text-stone-400">Centre points · settlement polygons</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canMapFeatures && (
              <Link
                href="/settings/geo"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <MapPin className="w-4 h-4 text-fuchsia-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Geography Canvas</p>
                  <p className="text-xs text-stone-400">Move facilities · redraw settlement boundaries — on the map</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canMapFeatures && (
              <Link
                href="/settings/partners"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Briefcase className="w-4 h-4 text-rose-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Partners</p>
                  <p className="text-xs text-stone-400">Partner organisations · settlements · centres</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canFacilityIndicators && (
              <Link
                href="/settings/facility-indicators"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Activity className="w-4 h-4 text-emerald-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Facility Indicators (Layer 2)</p>
                  <p className="text-xs text-stone-400">Utilization · enrollment · saturation per facility</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canCaregiverPractices && (
              <Link
                href="/settings/caregiver-practices"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <ListChecks className="w-4 h-4 text-teal-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Caregiver Practices</p>
                  <p className="text-xs text-stone-400">Creche visit observation taxonomy · category → subcategory → practice</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canMisProviders && (
              <Link
                href="/settings/mis-providers"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Cloud className="w-4 h-4 text-sky-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">MIS Providers</p>
                  <p className="text-xs text-stone-400">External MIS APIs feeding indicators (e.g. Frappe Creche MIS)</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canJourneyOutcomePacks && (
              <Link
                href="/settings/journey-outcome-packs"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Layers className="w-4 h-4 text-indigo-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Journey Outcome Packs (Layer 3)</p>
                  <p className="text-xs text-stone-400">Reusable outcome definitions you can apply to programme journeys</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Administration — visible if user has any sub-permission */}
      {showAdminSection && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-stone-700 mb-1">Administration</h2>
          <p className="text-xs text-stone-500 mb-3">Per-role configurable via Roles &amp; Permissions.</p>
          <div className="space-y-2">
            {canTemplates && (
              <Link
                href="/settings/control-plane"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Network className="w-4 h-4 text-fuchsia-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Backend Control Plane</p>
                  <p className="text-xs text-stone-400">Live graph of templates · checklists · catalog · indicators · outcomes — with broken-connection alerts</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canUsers && (
              <Link
                href="/settings/users"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">User Management</p>
                  <p className="text-xs text-stone-400">Add · delete · reset passwords</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canRoles && (
              <Link
                href="/settings/roles"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-amber-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Roles &amp; Permissions</p>
                  <p className="text-xs text-stone-400">Edit what each role can do · per-section</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canAuditLog && (
              <Link
                href="/settings/audit"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <ScrollText className="w-4 h-4 text-stone-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Audit Log</p>
                  <p className="text-xs text-stone-400">System actions · scoped by your audit_log.list permission</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canTemplates && (
              <Link
                href="/settings/templates"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <LayoutTemplate className="w-4 h-4 text-violet-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Goal Templates</p>
                  <p className="text-xs text-stone-400">Edit pitstops · checklists · SLAs · parameters</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canTemplates && (
              <Link
                href="/settings/catalogs"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <LayoutTemplate className="w-4 h-4 text-sky-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Visit Catalogs</p>
                  <p className="text-xs text-stone-400">Live-centre categories &amp; visit cadence per domain</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canWikiStaff && (
              <Link
                href="/settings/wiki-staff"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-pink-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Wiki Staff</p>
                  <p className="text-xs text-stone-400">Designate curators &amp; stewards — per city or global</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canTemplates && (
              <Link
                href="/settings/enum-labels"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <ListChecks className="w-4 h-4 text-teal-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Labels</p>
                  <p className="text-xs text-stone-400">Rename fixed system options (practice statuses/actions, indicator sources)</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
            {canFacilityLayers && (
              <Link
                href="/settings/facility-layers"
                className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Layers className="w-4 h-4 text-violet-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800">Facility Layer Types</p>
                  <p className="text-xs text-stone-400">Manage facility types for goal creation wizard</p>
                </div>
                <ChevronRight className="w-4 h-4 text-stone-300" />
              </Link>
            )}
          </div>
        </section>
      )}

      {canInviteCode && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-stone-700 mb-1">Invite Code</h2>
          <p className="text-xs text-stone-500 mb-4">
            Share this code with people you want to invite. They&apos;ll need it to register.
            {canRotateInvite && " Rotating the code prevents new signups with the old code."}
          </p>

          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl">
              <span className="font-mono text-lg font-semibold text-stone-900 tracking-widest">
                {code ?? "Loading..."}
              </span>
            </div>

            <button
              onClick={handleCopy}
              disabled={!code}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors disabled:opacity-40"
              title="Copy code"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-stone-500" />}
              <span className="text-stone-600">{copied ? "Copied" : "Copy"}</span>
            </button>

            {canRotateInvite && (
              <button
                onClick={handleRotate}
                disabled={rotating || !code}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm border border-stone-200 rounded-xl hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-40"
                title="Rotate code"
              >
                <RefreshCw className={`w-4 h-4 ${rotating ? "animate-spin" : ""}`} />
                <span>Rotate</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* External calendar — per-user (their own iCal URL). Not viewer; gated on
          calendar.subscribe so admins can disable via /settings/roles if desired. */}
      {!isViewer && canExternalCalendar && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-4 h-4 text-stone-400" />
            <h2 className="text-sm font-semibold text-stone-700">My Outlook / Google Calendar</h2>
          </div>
          <p className="text-xs text-stone-500 mb-4">
            Paste your calendar&apos;s iCal (.ics) subscription URL here. Your personal events will appear
            in grey on the Activities calendar — read-only, visible only to you.
          </p>
          <details className="mb-3 text-xs text-stone-400 group">
            <summary className="cursor-pointer hover:text-stone-600 select-none">How to get the URL from Outlook</summary>
            <ol className="mt-2 space-y-1 pl-4 list-decimal text-stone-500">
              <li>Open <strong>Outlook on the web</strong> (outlook.office.com or outlook.live.com)</li>
              <li>Go to <strong>Calendar → Settings (gear icon) → View all Outlook settings</strong></li>
              <li>Select <strong>Calendar → Shared calendars</strong></li>
              <li>Under <strong>Publish a calendar</strong>, choose your calendar and set permissions to <em>Can view all details</em></li>
              <li>Click <strong>Publish</strong> — copy the <strong>ICS</strong> link (not the HTML one)</li>
            </ol>
          </details>
          <form onSubmit={handleSaveCalUrl} className="space-y-3 max-w-lg">
            <input
              type="url"
              placeholder="https://outlook.live.com/owa/calendar/…/calendar.ics"
              value={externalCalUrl}
              onChange={(e) => { setExternalCalUrl(e.target.value); setCalSuccess(false); }}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-300 bg-white font-mono"
            />
            {calError && <p className="text-xs text-red-500">{calError}</p>}
            {calSuccess && <p className="text-xs text-emerald-600">Calendar URL saved. Your events will appear on Activities.</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={calSaving}
                className="px-4 py-2 text-sm font-medium bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50"
              >
                {calSaving ? "Saving…" : "Save"}
              </button>
              {externalCalUrl && (
                <button
                  type="button"
                  onClick={() => { setExternalCalUrl(""); setCalSuccess(false); }}
                  className="px-4 py-2 text-sm text-stone-500 border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {canMembers && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-stone-400" />
            <h2 className="text-sm font-semibold text-stone-700">Members</h2>
            <span className="text-xs text-stone-400">({members.length})</span>
          </div>

          <div className="space-y-1">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-lg">
                <Avatar name={m.name} image={m.image} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800 truncate">{m.name ?? "—"}</p>
                  <p className="text-xs text-stone-400 truncate">{m.email}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
    </SurfaceProvider>
  );
}
