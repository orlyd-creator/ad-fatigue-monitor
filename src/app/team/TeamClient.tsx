"use client";

import { useState } from "react";

type Invite = {
  email: string;
  invitedAt: number;
  invitedBy: string | null;
  lastSeenAt: number | null;
};

function formatDate(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TeamClient({ initialInvites }: { initialInvites: Invite[] }) {
  const [invites, setInvites] = useState<Invite[]>(initialInvites);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessEmail(null);
    if (!email.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Invite failed. Try again.");
      }
      const data = await res.json();
      // Refresh list
      const listRes = await fetch("/api/team/invites");
      const listData = await listRes.json();
      setInvites(listData.invites || []);
      setSuccessEmail(data.email);
      setEmail("");
      setTimeout(() => setSuccessEmail(null), 3500);
    } catch (err: any) {
      setError(err?.message || "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(emailToRevoke: string) {
    if (!confirm(`Revoke access for ${emailToRevoke}?`)) return;
    const res = await fetch(`/api/team/invites?email=${encodeURIComponent(emailToRevoke)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setInvites(prev => prev.filter(i => i.email !== emailToRevoke));
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Share workspace</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Invite your team by email. They'll see exactly what you see — no setup required on their side.
        </p>
      </div>

      {/* Invite form */}
      <div className="lv-card p-6 mb-6">
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Invite a teammate</h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          Enter their work email. When they log in with Facebook, they'll get instant access.
        </p>
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            autoComplete="email"
            className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-white/50 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#9b87f5]/40"
            disabled={inviting}
          />
          <button
            type="submit"
            disabled={inviting || !email.trim()}
            className="px-5 py-2.5 rounded-xl text-[14px] font-medium text-white
              bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8]
              shadow-md shadow-purple-100 hover:shadow-lg
              disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {inviting ? "Inviting..." : "Invite"}
          </button>
        </form>
        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">
            {error}
          </div>
        )}
        {successEmail && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-[13px] text-green-700">
            Invited {successEmail}. Send them the app URL — they'll log in with Facebook and get instant access.
          </div>
        )}
      </div>

      {/* Invites list */}
      <div className="lv-card p-6">
        <h2 className="text-[15px] font-semibold text-foreground mb-4">
          Team members {invites.length > 0 && <span className="text-muted-foreground font-normal">({invites.length})</span>}
        </h2>
        {invites.length === 0 ? (
          <p className="text-[13px] text-muted-foreground italic">No team members invited yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {invites.map((invite) => (
              <li key={invite.email} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-medium text-foreground">{invite.email}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    Invited {formatDate(invite.invitedAt)}
                    {invite.lastSeenAt ? ` · last seen ${formatDate(invite.lastSeenAt)}` : " · hasn't logged in yet"}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(invite.email)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 text-[12px] text-muted-foreground">
        Teammates see the same Meta Ads and HubSpot data you see. They don't need to connect anything.
      </div>
    </main>
  );
}
