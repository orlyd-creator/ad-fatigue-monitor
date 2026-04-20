import { signInWithFacebook, signInWithGoogle } from "./actions";
import { auth, isGoogleEnabled } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ fresh?: string; share?: string; reason?: string }> }) {
  const params = await searchParams;
  if (!params.fresh) {
    const session = await auth();
    if (session && (session as any).accountId) {
      redirect("/dashboard");
    }
  }
  const shareState = params.share || null;
  const shareReason = params.reason || null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-white/80 via-[#C5D9F5]/40 via-[#9B7ED0]/30 to-[#D06AB8]/20 px-4 py-12">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6B93D8] via-[#D06AB8] to-[#F04E80] flex items-center justify-center text-white font-bold text-2xl mx-auto mb-5 shadow-xl shadow-blue-200/50">
            OD
          </div>
          <h1 className="text-3xl font-bold text-black tracking-tight">OD</h1>
          <p className="text-[15px] text-gray-600 mt-3 max-w-sm mx-auto leading-relaxed">
            Your source of truth for ad performance, fatigue detection, lead analytics, and smarter spend.
          </p>
        </div>

        {shareState === "pending" && (
          <div className="mb-5 px-4 py-3 rounded-2xl bg-green-50 border border-green-200 text-[13px] text-green-800">
            You've been invited to a shared workspace. Sign in with Facebook to get access.
          </div>
        )}
        {shareState === "invalid" && (
          <div className="mb-5 px-4 py-3 rounded-2xl bg-red-50 border border-red-200 text-[13px] text-red-800">
            {shareReason === "not_found" && "This share link doesn't exist or was never created. Ask the person who sent it for a new one."}
            {shareReason === "revoked" && "This share link has been revoked. Ask the person who sent it for a new one."}
            {shareReason === "expired" && "This share link has expired. Ask the person who sent it for a new one."}
            {shareReason === "error" && "Something went wrong validating this link. Please try again in a moment."}
            {!shareReason && "This share link is expired or has been revoked. Ask the person who sent it for a new one."}
          </div>
        )}

        {/* Connect */}
        <div className="lv-card p-7 mb-5">
          <h2 className="text-[17px] font-semibold text-black mb-2">
            {shareState === "pending" ? "Sign in to continue" : "Connect your Meta account"}
          </h2>
          <p className="text-[14px] text-gray-600 mb-6 leading-relaxed">
            {shareState === "pending"
              ? "Just sign in with Facebook — no integrations needed. You'll land on the shared dashboard in one click."
              : "We'll pull your ad performance and lead data into one place — so you always know what's working, what's fatigued, and where your next lead is coming from."}
          </p>

          <form action={signInWithFacebook}>
          <button type="submit"
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-[#6B93D8] via-[#D06AB8] to-[#F04E80] hover:from-[#5A82C8] hover:via-[#C05AA8] hover:to-[#E04070] text-white font-medium text-[15px] transition-colors shadow-lg shadow-blue-200/50">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Continue with Facebook
          </button>
          </form>

          {isGoogleEnabled && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-[12px] text-gray-500 font-medium">or</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>
              <form action={signInWithGoogle}>
                <button type="submit"
                  className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 font-medium text-[15px] transition-colors shadow-sm">
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
                  </svg>
                  Continue with Google
                </button>
              </form>
            </>
          )}

          <div className="mt-5 flex items-start gap-3 p-4 rounded-2xl bg-green-50/60">
            <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <p className="text-[12px] text-green-800 leading-relaxed">
              Read-only access only — we never change anything in your ad account. Your data, your control.
            </p>
          </div>
        </div>

        {/* Tagline */}
        <p className="text-center text-[13px] text-black font-medium mt-2">
          Ad fatigue. Lead analytics. One dashboard.
        </p>
      </div>
    </div>
  );
}
