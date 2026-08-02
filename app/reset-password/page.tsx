"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Target } from "lucide-react";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  // Arrived from an invite, so there is no old password being replaced.
  const isInvite = searchParams.get("invite") === "1";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    setLoading(false);

    if (res.ok) {
      setSuccess(true);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Something went wrong. Please try again.");
    }
  };

  if (!token) {
    return (
      <p className="text-sm text-stone-700 text-center">
        This link has expired or is invalid.{" "}
        <Link href="/forgot-password" className="text-sky-600 hover:text-sky-700 font-medium">
          Request a new one
        </Link>
      </p>
    );
  }

  if (success) {
    return (
      <div className="text-center space-y-3">
        <p className="text-sm text-stone-700">Password updated.</p>
        <Link href="/login" className="block text-sm text-sky-600 hover:text-sky-700 font-medium">
          Sign in
        </Link>
      </div>
    );
  }

  if (error === "This link has expired or is invalid.") {
    return (
      <div className="text-center space-y-3">
        <p className="text-sm text-stone-700">This link has expired or is invalid.</p>
        <Link href="/forgot-password" className="block text-xs text-sky-600 hover:text-sky-700 font-medium">
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isInvite && (
        <p className="text-sm text-stone-500">
          Choose a password for your grant reporting account. You&apos;ll sign in with this email from now on.
        </p>
      )}
      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1">{isInvite ? "Password" : "New Password"}</label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent"
          placeholder="••••••••"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1">Confirm Password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent"
          placeholder="••••••••"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={loading || !password || !confirm}
        className="w-full py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {loading ? "Saving..." : isInvite ? "Set password" : "Update Password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-10 h-10 bg-sky-500 rounded-xl flex items-center justify-center mb-3">
            <Target className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-stone-900">Pitstop</h1>
          <p className="text-sm text-stone-500 mt-1">Choose a new password</p>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <Suspense fallback={<p className="text-sm text-stone-500 text-center">Loading...</p>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
