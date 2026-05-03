export const dynamic = "force-static";

export default function PublicInvalidPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="lv-card p-8 max-w-md text-center">
        <div className="display-label mb-2">Shared link</div>
        <h1 className="text-[22px] font-semibold mb-3 gradient-text">This link is no longer active</h1>
        <p className="text-[14px] leading-[1.65] text-foreground/80 mb-5">
          The view-only link you followed has been revoked, expired, or never existed. Ask whoever sent it for a fresh link.
        </p>
        <a
          href="/login"
          className="inline-block px-4 py-2.5 rounded-xl bg-gradient-to-br from-[#6B93D8] via-[#9B7ED0] to-[#D06AB8] text-white text-[13.5px] font-semibold shadow-sm hover:shadow-md transition"
        >
          Go to login
        </a>
      </div>
    </main>
  );
}
