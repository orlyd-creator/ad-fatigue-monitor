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

type PublicLink = {
  token: string;
  label: string | null;
  createdAt: number;
  createdBy: string | null;
  revokedAt: number | null;
  viewsCount: number;
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
  initialPublicLinks,
  origin,
}: {
  initialInvites: Invite[];
  initialTokens: ShareToken[];
  initialPublicLinks: PublicLink[];
  origin: string;
}) {
  const [invites, setInvites] = useState<Invite[]>(initialInvites);
  const [tokens, setTokens] = useState<ShareToken[]>(initialTokens);
  const [publicLinks, setPublicLinks] = useState<PublicLink[]>(initialPublicLinks);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  const [linkLabel, setLinkLabel] = useState("");
  const [creatingLink, setCreatingLink] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [publicLabel, setPublicLabel] = useState("");
  const [creatingPublic, setCreatingPublic] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState<string | null>(null);

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

  async function handleCreatePublic(e: React.FormEvent) {
    e.preventDefault();
    setCreatingPublic(true);
    try {
      const res = await fetch("/api/team/public-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: publicLabel.trim() || null }),
      });
      if (!res.ok) throw new Error("Couldn't create public link");
      const listRes = await fetch("/api/team/public-links");
      const listData = await listRes.json();
      setPublicLinks(listData.tokens || []);
      setPublicLabel("");
    } catch (err: any) {
      alert(err?.message || "Error creating public link");
    } finally {
      setCreatingPublic(false);
    }
  }

  async function handleRevokePublic(token: string) {
    if (!confirm("Revoke this public link? Anyone with the URL will get an error.")) return;
    const res = await fetch(`/api/team/public-links?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setPublicLinks(prev => prev.map(t => t.token === token ? { ...t, revokedAt: Date.now() } : t));
    }
  }

  function copyPublic(token: string) {
    // /public/<token> is a redirect route that sets the public_view cookie
    // and sends the viewer to /dashboard. From there, Dashboard / Leads /
    // Executive / Ads all work without login.
    const url = `${origin}/public/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedPublic(token);
    setTimeout(() => setCopiedPublic(null), 1800);
  }

  const activeTokens = tokens.filter(t => !t.revokedAt);
  const activePublic = publicLinks.filter(t => !t.revokedAt);

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Share workspace</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Share your exact view with your team. No setup required on their side.
        </p>
      </div>

      {/* Public view-only link (no login required) */}
      <div className="lv-card p-6 mb-6 border-2 border-[#D06AB8]/30 bg-gradient-to-br from-[#6B93D8]/5 via-[#9B7ED0]/5 to-[#D06AB8]/5">
        <div className="flex items-center gap-2 mb-1">
          <svg className="w-4 h-4 text-[#D06AB8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h2 className="text-[15px] font-semibold text-foreground">Public view-only link</h2>
          <span className="text-[11px] font-medium text-[#D06AB8] bg-[#D06AB8]/10 px-2 py-0.5 rounded-full">No login</span>
        </div>
        <p className="text-[13px] text-muted-foreground mb-4">
          Create a link that opens the <span className="font-medium text-foreground">whole platform</span> — Dashboard, Leads, Executive, Ads, all of it.
          No sign-in, no Facebook. Live data, view-only. Revoke anytime.
        </p>
        <form onSubmit={handleCreatePublic} className="flex gap-2">
          <input
            type="text"
            value={publicLabel}
            onChange={(e) => setPublicLabel(e.target.value)}
            placeholder="Label (optional): e.g. Board, Investors, CEO"
            maxLength={80}
            className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-white/50 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#D06AB8]/40"
            disabled={creatingPublic}
          />
          <button
            type="submit"
            disabled={creatingPublic}
            className="px-5 py-2.5 rounded-xl text-[14px] font-medium text-white
              bg-gradient-to-r from-[#9B7ED0] to-[#D06AB8]
              shadow-md shadow-pink-100 hover:shadow-lg disabled:opacity-40 transition-all"
          >
            {creatingPublic ? "Creating..." : "Create public link"}
          </button>
        </form>

        {activePublic.length > 0 && (
          <ul className="mt-5 space-y-2">
            {activePublic.map(t => {
              const url = `${origin}/public/${t.token}`;
              return (
                <li key={t.token} className="flex items-center gap-2 p-3 rounded-xl bg-white/70 border border-border">
                  <div className="flex-1 min-w-0">
                    {t.label && <div className="text-[13px] font-medium text-foreground">{t.label}</div>}
                    <div className="text-[12px] font-mono text-muted-foreground truncate" title={url}>{url}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Created {formatDate(t.createdAt)} · Viewed {t.viewsCount}×
                    </div>
                  </div>
                  <button
                    onClick={() => copyPublic(t.token)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#D06AB8] text-white hover:bg-[#B858A0] transition-colors"
                  >
                    {copiedPublic === t.token ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => handleRevokePublic(t.token)}
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
