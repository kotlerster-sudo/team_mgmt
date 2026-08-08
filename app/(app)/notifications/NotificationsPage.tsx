"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck, CalendarClock } from "lucide-react";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

const typeLabel: Record<string, string> = {
  Mention: "Mention",
  NewPitstop: "New Pitstop",
  GoalStatusChange: "Status Change",
  PitstopStatusChange: "Status Change",
  NewMessage: "Message",
  GoalFollowed: "Follower",
  ActivityTagged: "Activity",
  ActivityFollowup: "Activity",
  ActivityMorningNudge: "Activity",
  WeeklyPlanNudge: "Planning",
  EscalationAlert: "Escalation",
  BroadcastUpdate: "Update",
  TaskAssigned: "Task",
  CatalogItemDeployed: "Centre",
};

type FollowupState = "idle" | "loading" | "done" | "cancelled" | "rescheduling" | "rescheduled" | "no";
type InviteState = "idle" | "loading" | "accepted" | "declined";

function ActivityInviteActions({ eventId, onResponded }: { eventId: string; onResponded: () => void }) {
  const [state, setState] = useState<InviteState>("idle");
  const [error, setError] = useState("");

  const respond = async (action: "accept" | "decline") => {
    setState("loading");
    setError("");
    const res = await fetch(`/api/pitstop-events/${eventId}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) { setError("Something went wrong."); setState("idle"); return; }
    setState(action === "accept" ? "accepted" : "declined");
    onResponded();
  };

  if (state === "accepted") return <p className="text-xs text-emerald-600 font-medium mt-2">✓ You&apos;re going</p>;
  if (state === "declined") return <p className="text-xs text-stone-400 font-medium mt-2">Invite declined</p>;
  if (state === "loading") return <p className="text-xs text-stone-400 mt-2">Saving…</p>;

  return (
    <div className="flex gap-2 mt-2">
      <button onClick={() => respond("accept")}
        className="px-3 py-1 text-xs rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium transition-colors">
        Accept
      </button>
      <button onClick={() => respond("decline")}
        className="px-3 py-1 text-xs rounded-md bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium transition-colors">
        Decline
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function ActivityFollowupActions({ eventId, onResponded }: { eventId: string; onResponded: () => void }) {
  const [state, setState] = useState<FollowupState>("idle");
  const [newDate, setNewDate] = useState("");
  const [error, setError] = useState("");

  const respond = async (action: string, extra?: Record<string, string>) => {
    setState("loading");
    setError("");
    const res = await fetch(`/api/pitstop-events/${eventId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    if (!res.ok) { setError("Something went wrong."); setState("idle"); return; }
    const data = await res.json();
    if (action === "yes")        { setState("done"); onResponded(); }
    else if (action === "cancel") { setState("cancelled"); onResponded(); }
    else if (action === "reschedule") { setState("rescheduled"); onResponded(); }
    else if (action === "no") setState(data.next === "choose_cancel_or_reschedule" ? "no" : "idle");
  };

  if (state === "done")       return <p className="text-xs text-emerald-600 font-medium mt-2">✓ Marked as done</p>;
  if (state === "cancelled")  return <p className="text-xs text-stone-400 font-medium mt-2">Activity cancelled</p>;
  if (state === "rescheduled") return <p className="text-xs text-sky-600 font-medium mt-2">✓ Rescheduled</p>;
  if (state === "loading")    return <p className="text-xs text-stone-400 mt-2">Saving…</p>;

  if (state === "no") return (
    <div className="flex flex-wrap gap-2 mt-2">
      <button onClick={() => respond("cancel")}
        className="px-3 py-1 text-xs rounded-md bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium transition-colors">
        Cancel activity
      </button>
      <button onClick={() => setState("rescheduling")}
        className="px-3 py-1 text-xs rounded-md bg-sky-50 hover:bg-sky-100 text-sky-700 font-medium transition-colors">
        Reschedule
      </button>
      {error && <p className="text-xs text-red-500 w-full">{error}</p>}
    </div>
  );

  if (state === "rescheduling") return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      <input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)}
        className="text-xs border border-stone-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-400" />
      <button disabled={!newDate} onClick={() => respond("reschedule", { scheduledAt: new Date(newDate).toISOString() })}
        className="px-3 py-1 text-xs rounded-md bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-medium transition-colors">
        Confirm
      </button>
      <button onClick={() => setState("no")} className="px-2 py-1 text-xs text-stone-400 hover:text-stone-600">Back</button>
      {error && <p className="text-xs text-red-500 w-full">{error}</p>}
    </div>
  );

  return (
    <div className="flex gap-2 mt-2">
      <button onClick={() => respond("yes")}
        className="px-3 py-1 text-xs rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium transition-colors">
        Yes, done
      </button>
      <button onClick={() => respond("no")}
        className="px-3 py-1 text-xs rounded-md bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium transition-colors">
        No
      </button>
    </div>
  );
}

export default function NotificationsPage({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [notifications, setNotifications] = useState(initialNotifications);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    setNotifications((ns) => ns.filter((n) => n.id !== id));
    window.dispatchEvent(new Event("pitstop:notifications-changed"));
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST" });
    setNotifications([]);
    window.dispatchEvent(new Event("pitstop:notifications-changed"));
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-stone-500 mt-0.5">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-md transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-20">
          <Bell className="w-8 h-8 text-stone-300 mx-auto mb-3" />
          <p className="text-stone-400 text-sm">No notifications yet.</p>
          <p className="text-stone-400 text-xs mt-1">Follow goals and subscribe to threads to get notified.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {notifications.map((n) => {
            const isFollowup = n.type === "ActivityFollowup" || n.type === "ActivityMorningNudge";
            const isInvite = n.type === "ActivityTagged" && !!n.link?.includes("?invite=");
            const eventId = isFollowup && n.link ? new URL(n.link, "http://x").searchParams.get("followup") : null;
            const inviteEventId = isInvite && n.link ? new URL(n.link, "http://x").searchParams.get("invite") : null;

            const inner = (
              <div className="flex items-start gap-3 px-4 py-3.5 rounded-lg border bg-sky-50 border-sky-100 text-stone-800 transition-colors">
                <div className="mt-0.5 w-2 h-2 rounded-full flex-shrink-0 bg-sky-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400">
                      {typeLabel[n.type] ?? n.type}
                    </span>
                    <span className="text-[10px] text-stone-400">
                      {new Date(n.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-stone-900">{n.title}</p>
                  {n.body && <p className="text-xs text-stone-500 mt-0.5">{n.body}</p>}
                  {isFollowup && eventId && (
                    <ActivityFollowupActions
                      eventId={eventId}
                      onResponded={() => {
                        fetch(`/api/notifications/${n.id}`, { method: "PATCH" });
                        setNotifications((ns) => ns.filter((x) => x.id !== n.id));
                        window.dispatchEvent(new Event("pitstop:notifications-changed"));
                      }}
                    />
                  )}
                  {isInvite && inviteEventId && (
                    <ActivityInviteActions
                      eventId={inviteEventId}
                      onResponded={() => {
                        fetch(`/api/notifications/${n.id}`, { method: "PATCH" });
                        setNotifications((ns) => ns.filter((x) => x.id !== n.id));
                        window.dispatchEvent(new Event("pitstop:notifications-changed"));
                      }}
                    />
                  )}
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); markRead(n.id); }}
                  title="Mark as read"
                  className="flex-shrink-0 p-1 text-stone-400 hover:text-sky-600 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            );

            if (isFollowup || isInvite) return <div key={n.id}>{inner}</div>;

            return n.link ? (
              <Link key={n.id} href={n.link} onClick={() => !n.read && markRead(n.id)}>
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
