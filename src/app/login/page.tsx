import { signInWithFacebook } from "./actions";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[#FDF2F8] via-[#FFF5F7] to-[#FFF5F7] px-4 py-12">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#EC4899] to-[#8B5CF6] flex items-center justify-center text-white font-bold text-2xl mx-auto mb-5 shadow-xl shadow-pink-200/50">
            AF
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Ad Fatigue Monitor</h1>
          <p className="text-[15px] text-muted-foreground mt-3 max-w-sm mx-auto leading-relaxed">
            Know when your ads are getting tired,before your wallet notices.
          </p>
        </div>

        {/* Connect */}
        <div className="lv-card p-7 mb-5">
          <h2 className="text-[17px] font-semibold text-foreground mb-2">Connect your Meta account</h2>
          <p className="text-[14px] text-muted-foreground mb-6 leading-relaxed">
            We&apos;ll read your ad performance data to spot fatigue patterns. That&apos;s it,no changes to your ads, no posting, no spending.
          </p>

          <form action={signInWithFacebook}>
          <button type="submit"
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-[#EC4899] to-[#8B5CF6] hover:from-[#DB2777] hover:to-[#7C3AED] text-white font-medium text-[15px] transition-all shadow-lg shadow-pink-200/50">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Connect with Facebook
          </button>
          </form>

          <div className="mt-5 flex items-start gap-3 p-4 rounded-2xl bg-green-50">
            <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <p className="text-[12px] text-green-800 leading-relaxed">
              Your data stays on your machine. Read-only access only,we can&apos;t change anything in your ad account.
            </p>
          </div>
        </div>

        {/* Setup Guide */}
        <div className="lv-card p-7">
          <h3 className="text-[15px] font-semibold text-foreground mb-5">First time? Here&apos;s how to set it up</h3>

          <div className="space-y-5">
            <Step n={1} title="Create a Meta Developer App">
              Go to <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="text-[#EC4899] font-medium hover:underline">developers.facebook.com/apps</a> and click &quot;Create App&quot;. Pick &quot;Other&quot;, then &quot;Business&quot;.
            </Step>
            <Step n={2} title="Add Marketing API">
              In your app dashboard, find &quot;Add Products&quot; and add <strong>Marketing API</strong>.
            </Step>
            <Step n={3} title="Get your App ID and Secret">
              Go to Settings &rarr; Basic. Copy the <strong>App ID</strong> and <strong>App Secret</strong>.
            </Step>
            <Step n={4} title="Paste into .env.local">
              Open <code className="text-[11px] px-2 py-1 bg-accent-light rounded-lg text-[#DB2777] font-mono">~/ad-fatigue-monitor/.env.local</code> and fill in your credentials.
            </Step>
            <Step n={5} title="Click Connect above!">
              Your ads will appear on the dashboard after you hit &quot;Refresh Data&quot;.
            </Step>
          </div>

          <div className="mt-6 p-5 rounded-2xl bg-accent-light">
            <p className="text-[13px] text-[#DB2777] leading-relaxed">
              <strong className="text-foreground">Day-to-day:</strong> Just open <code className="text-[11px] px-1.5 py-0.5 bg-white rounded-lg font-mono text-[#DB2777]">localhost:3000</code> in your browser. Click &quot;Refresh Data&quot; for latest numbers. Check once a day,orange or red cards mean it&apos;s time to swap creatives.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="w-7 h-7 rounded-full bg-accent-light text-[#DB2777] flex items-center justify-center flex-shrink-0 text-[12px] font-bold">{n}</div>
      <div>
        <div className="text-[14px] font-medium text-foreground">{title}</div>
        <div className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
