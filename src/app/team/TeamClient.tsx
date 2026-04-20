"use client";

import { useState } from "react";

type Invite = {
  email: string;
  invitedAt: number;
  invitedBy: string | null;
  lastSeenAt: number | null;
};

type ShareToken = {
  token: string;
  label: string | null;
  createdAt: number;
  createdBy: string | null;
  expiresAt: number | null;
  revokedAt: number | null;
  usesCount: number;
};

function formatDate(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TeamClient({
  initialInvites,
  initialTokens,
  origin,
}: {
  initialInvites: Invite[];
  initialTokens: ShareToken[];
  origin: string;
}) {
  const [invites, setInvites] = useState<Invite[]>(initialInvites);
  const [tokens, setTokens] = useState<ShareToken[]>(initialTokens);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  const [linkLabel, setLinkLabel] = useState("");
  const [creatingLink, setCreatingLink] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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

  async function handleRevokeInvite(emailToRevoke: string) {
    if (!confirm(`Revoke access for ${emailToRevoke}?`)) return;
    const res = await fetch(`/api/team/invites?email=${encodeURIComponent(emailToRevoke)}`, {
      method: "DELETE",
    });
    if (res.ok) setInvites(prev => prev.filter(i => i.email !== emailToRevoke));
  }

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    setCreatingLink(true);
    try {
      const res = await fetch("/api/team/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: linkLabel.trim() || null }),
      });
      if (!res.ok) throw new Error("Couldn't create link");
      const listRes = await fetch("/api/team/share-links");
      const listData = await listRes.json();
      setTokens(listData.tokens || []);
      setLinkLabel("");
    } catch (err: any) {
      alert(err?.message || "Error creating link");
    } finally {
      setCreatingLink(false);
    }
  }

  async function handleRevokeLink(token: string) {
    if (!confirm("Revoke this share link? Anyone with the URL can't use it anymore.")) return;
    const res = await fetch(`/api/team/share-links?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setTokens(prev => prev.map(t => t.token === token ? { ...t, revokedAt: Date.now() } : t));
    }
  }

  function copyLink(token: string) {
    const url = `${origin}/share/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 1800);
  }

  const activeTokens = tokens.filter(t => !t.revokedAt);

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Share workspace</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Share your exact view with your team. No setup required on their side.
        </p>
      </div>

      {/* Share link section (primary CTA) */}
      <div className="lv-card p-6 mb-6 border-2 border-[#9b87f5]/20">
        <div className="flex items-center gap-2 mb-1">
          <svg className="w-4 h-4 text-[#9B7ED0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
          <h2 className="text-[15px] font-semibold text-foreground">Create a share link</h2>
        </div>
        <p className="text-[13px] text-muted-foreground mb-4">
          Send this link to anyone. They click → log in with Facebook → instant access to your workspace. No email matching needed.
        </p>
        <form onSubmit={handleCreateLink} className="flex gap-2">
          <input
            type="text"
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="Label (optional): e.g. Orly, Finance team"
            maxLength={80}
            className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-white/50 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#9b87f5]/40"
            disabled={creatingLink}
          />
          <button
            type="submit"
            disabled={creatingLink}
            className="px-5 py-2.5 rounded-xl text-[14px] font-medium text-white
              bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8]
              shadow-md shadow-purple-100 hover:shadow-lg disabled:opacity-40 transition-all"
          >
            {creatingLink ? "Creating..." : "Create link"}
          </button>
        </form>

        {activeTokens.length > 0 && (
          <ul className="mt-5 space-y-2">
            {activeTokens.map(t => {
              const url = `${origin}/share/${t.token}`;
              return (
                <li key={t.token} className="flex items-center gap-2 p-3 rounded-xl bg-white/60 border border-border">
                  <div className="flex-1 min-w-0">
                    {t.label && <div className="text-[13px] font-medium text-foreground">{t.label}</div>}
                    <div className="text-[12px] font-mono text-muted-foreground truncate" title={url}>{url}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Created {formatDate(t.createdAt)} · Used {t.usesCount}×
                    </div>
                  </div>
                  <button
                    onClick={() => copyLink(t.token)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#9B7ED0] text-white hover:bg-[#8A6BC0] transition-colors"
                  >
                    {copied === t.token ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => handleRevokeLink(t.token)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    Revoke
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Email invite (secondary) */}
      <div className="lv-card p-6 mb-6">
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Or invite by email</h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          Enter a specific email (<span className="font-mono text-foreground">orly.d@obol.app</span>) or a whole domain
          (<span className="font-mono text-foreground">@obol.app</span>). Only works if their Facebook email matches.
        </p>
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="orly.d@obol.app  or  @obol.app"
            autoComplete="off"
            className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-white/50 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#9b87f5]/40"
            disabled={inviting}
          />
          <button
            type="submit"
            disabled={inviting || !email.trim()}
            className="px-5 py-2.5 rounded-xl text-[14px] font-medium text-white
              bg-gradient-to-r from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8]
              shadow-md shadow-purple-100 hover:shadow-lg disabled:opacity-40 transition-all"
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
            Invited {successEmail}. Send them the app URL — they'll log in with Facebook and get access.
          </div>
        )}
      </div>

      {/* Team members list */}
      <div className="lv-card p-6">
        <h2 className="text-[15px] font-semibold text-foreground mb-4">
          Team members {invites.length > 0 && <span className="text-muted-foreground font-normal">({invites.length})</span>}
        </h2>
        {invites.length === 0 ? (
          <p className="text-[13px] text-muted-foreground italic">No team members yet. Share a link above to invite someone.</p>
        ) : (
          <ul className="divide-y divide-border">
            {invites.map((invite) => (
              <li key={invite.email} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-medium text-foreground">{invite.email}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    Added {formatDate(invite.invitedAt)}
                    {invite.lastSeenAt ? ` · last seen ${formatDate(invite.lastSeenAt)}` : " · hasn't logged in yet"}
                    {invite.invitedBy === "share-link" && " · via share link"}
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeInvite(invite.email)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 text-[12px] text-muted-foreground leading-relaxed">
        Teammates see your exact view — same Meta Ads, same HubSpot, no integrations required.
      </div>
    </main>
  );
}
