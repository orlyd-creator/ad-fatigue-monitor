"use client";

import { useState } from "react";

type Step = "welcome" | "apikey" | "funnel" | "done";

interface FunnelConfig {
  atmProperty: string;
  atmCustom: string;
  sqlClassification: string[];
  sqlCustomField: string;
  mqlDefinition: string;
  mqlCustomValue: string;
}

export default function ConnectHubSpotPage() {
  const [step, setStep] = useState<Step>("welcome");
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const [contactCount, setContactCount] = useState(0);
  const [saving, setSaving] = useState(false);

  const [funnel, setFunnel] = useState<FunnelConfig>({
    atmProperty: "agreed_to_meet_date___test_",
    atmCustom: "",
    sqlClassification: ["hs_lead_status_sql"],
    sqlCustomField: "",
    mqlDefinition: "form_fill",
    mqlCustomValue: "",
  });

  async function testConnection() {
    setTesting(true);
    setTestError("");
    try {
      const res = await fetch("/api/hubspot/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (data.success) {
        setContactCount(data.contactCount);
        setStep("funnel");
      } else {
        setTestError(data.error || "Connection failed. Check your token and try again.");
      }
    } catch {
      setTestError("Network error. Please try again.");
    } finally {
      setTesting(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const atmProp = funnel.atmProperty === "custom" ? funnel.atmCustom : funnel.atmProperty;
      const res = await fetch("/api/hubspot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          atmProperty: atmProp,
          sqlClassification: funnel.sqlClassification.map((c) => {
            if (c === "custom") return `custom:${funnel.sqlCustomField}`;
            return c;
          }),
          mqlDefinition:
            funnel.mqlDefinition === "custom"
              ? `custom:${funnel.mqlCustomValue}`
              : funnel.mqlDefinition,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStep("done");
      }
    } catch {
      // silently fail for now
    } finally {
      setSaving(false);
    }
  }

  function toggleSqlOption(value: string) {
    setFunnel((prev) => {
      const has = prev.sqlClassification.includes(value);
      return {
        ...prev,
        sqlClassification: has
          ? prev.sqlClassification.filter((v) => v !== value)
          : [...prev.sqlClassification, value],
      };
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-lg">
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-8 px-2">
          {(["welcome", "apikey", "funnel", "done"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div
                className={`h-1.5 w-full rounded-full transition-colors duration-300 ${
                  (["welcome", "apikey", "funnel", "done"] as Step[]).indexOf(step) >= i
                    ? "bg-gradient-to-r from-[#6B93D8] via-[#D06AB8] to-[#F04E80]"
                    : "bg-white/40"
                }`}
              />
            </div>
          ))}
        </div>

        {/* Step 1: Welcome */}
        {step === "welcome" && (
          <div className="lv-card p-8 sm:p-10 animate-fade-in">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6B93D8]/10 via-[#D06AB8]/10 to-[#F04E80]/10 mb-6">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#D06AB8]">
                  <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold gradient-text mb-3">
                Connect your HubSpot account
              </h1>
              <p className="text-[var(--muted)] text-sm sm:text-base leading-relaxed max-w-md mx-auto">
                We&apos;ll pull your lead data to calculate CPL, track demos booked, and show
                your full funnel alongside Meta ad spend.
              </p>
            </div>
            <button
              onClick={() => setStep("apikey")}
              className="cursor-pointer mt-8 w-full min-h-[44px] rounded-xl text-white font-semibold text-base
                bg-gradient-to-r from-[#6B93D8] via-[#D06AB8] to-[#F04E80]
                hover:opacity-90 active:scale-[0.98] transition-all duration-150"
            >
              Get Started
            </button>
          </div>
        )}

        {/* Step 2: API Key */}
        {step === "apikey" && (
          <div className="lv-card p-8 sm:p-10 animate-fade-in">
            <button
              onClick={() => setStep("welcome")}
              className="cursor-pointer text-[var(--muted)] hover:text-[var(--foreground)] text-sm mb-6 flex items-center gap-1 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            <h2 className="text-xl sm:text-2xl font-bold gradient-text mb-2">
              Enter your HubSpot Private App Token
            </h2>
            <p className="text-[var(--muted)] text-sm mb-6">
              We need a PAT with <span className="font-medium text-[var(--foreground)]">CRM read access</span> to pull your contacts.
            </p>

            <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
              Private App Token (PAT)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full px-4 py-3 min-h-[44px] rounded-xl border border-[var(--card-border)] bg-white/60
                text-sm font-mono placeholder:text-[var(--muted)]/50
                focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent
                transition-all"
            />

            <p className="text-xs text-[var(--muted)] mt-2">
              <a href="https://knowledge.hubspot.com/integrations/how-do-i-get-my-hubspot-api-key" target="_blank" rel="noopener noreferrer"
                className="underline decoration-dotted hover:text-[var(--foreground)] transition-colors cursor-pointer">
                How to create a PAT &rarr;
              </a>
            </p>

            {testError && (
              <div className="mt-4 p-3 rounded-xl bg-[var(--fatigued-bg)] border border-[var(--fatigued)]/20 text-sm text-[var(--fatigued)]">
                {testError}
              </div>
            )}

            <button
              onClick={testConnection}
              disabled={!apiKey.trim() || testing}
              className="cursor-pointer mt-6 w-full min-h-[44px] rounded-xl text-white font-semibold text-base
                bg-gradient-to-r from-[#6B93D8] via-[#D06AB8] to-[#F04E80]
                hover:opacity-90 active:scale-[0.98] transition-all duration-150
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Testing connection...
                </span>
              ) : (
                "Test Connection"
              )}
            </button>
          </div>
        )}

        {/* Step 3: Funnel Setup */}
        {step === "funnel" && (
          <div className="lv-card p-8 sm:p-10 animate-fade-in">
            <button
              onClick={() => setStep("apikey")}
              className="cursor-pointer text-[var(--muted)] hover:text-[var(--foreground)] text-sm mb-6 flex items-center gap-1 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            <h2 className="text-xl sm:text-2xl font-bold gradient-text mb-1">
              How do you track your buyer journey?
            </h2>
            <p className="text-[var(--muted)] text-sm mb-8">
              We found <span className="font-semibold text-[var(--foreground)]">{contactCount.toLocaleString()}</span> contacts in your account. Help us map your funnel.
            </p>

            {/* Question 1: ATM Property */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                What property tracks when a lead books a demo?
              </label>
              <select
                value={funnel.atmProperty}
                onChange={(e) => setFunnel((p) => ({ ...p, atmProperty: e.target.value }))}
                className="cursor-pointer w-full px-4 py-3 min-h-[44px] rounded-xl border border-[var(--card-border)] bg-white/60
                  text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent transition-all"
              >
                <option value="agreed_to_meet_date___test_">agreed_to_meet_date___test_ (default)</option>
                <option value="hs_sales_email_last_replied">hs_sales_email_last_replied</option>
                <option value="notes_last_contacted">notes_last_contacted</option>
                <option value="custom">Custom property...</option>
              </select>
              {funnel.atmProperty === "custom" && (
                <input
                  type="text"
                  value={funnel.atmCustom}
                  onChange={(e) => setFunnel((p) => ({ ...p, atmCustom: e.target.value }))}
                  placeholder="your_custom_property_name"
                  className="mt-2 w-full px-4 py-3 min-h-[44px] rounded-xl border border-[var(--card-border)] bg-white/60
                    text-sm font-mono placeholder:text-[var(--muted)]/50
                    focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent transition-all"
                />
              )}
            </div>

            {/* Question 2: SQL Classification */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                How do you classify SQLs?
              </label>
              <p className="text-xs text-[var(--muted)] mb-3">Select all that apply.</p>
              <div className="space-y-2">
                {[
                  { value: "hs_lead_status_sql", label: "hs_lead_status = SQL" },
                  { value: "lifecyclestage_opportunity", label: "lifecyclestage = opportunity" },
                  { value: "lifecyclestage_customer", label: "lifecyclestage = customer" },
                  { value: "custom", label: "Custom field..." },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className="cursor-pointer flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-xl border
                      border-[var(--card-border)] bg-white/40 hover:bg-white/60 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={funnel.sqlClassification.includes(opt.value)}
                      onChange={() => toggleSqlOption(opt.value)}
                      className="cursor-pointer w-4 h-4 rounded accent-[#D06AB8]"
                    />
                    <span className="text-sm pointer-events-none">
                      {opt.value === "custom" ? (
                        <span className="text-[var(--muted)]">{opt.label}</span>
                      ) : (
                        <code className="text-xs bg-[var(--surface)] px-1.5 py-0.5 rounded">{opt.label}</code>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              {funnel.sqlClassification.includes("custom") && (
                <input
                  type="text"
                  value={funnel.sqlCustomField}
                  onChange={(e) => setFunnel((p) => ({ ...p, sqlCustomField: e.target.value }))}
                  placeholder="property_name = value"
                  className="mt-2 w-full px-4 py-3 min-h-[44px] rounded-xl border border-[var(--card-border)] bg-white/60
                    text-sm font-mono placeholder:text-[var(--muted)]/50
                    focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent transition-all"
                />
              )}
            </div>

            {/* Question 3: MQL Definition */}
            <div className="mb-8">
              <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                What counts as an MQL / inbound lead?
              </label>
              <div className="space-y-2">
                {[
                  { value: "form_fill", label: "Anyone who fills an inbound form (has a create date)" },
                  { value: "lifecycle_stage", label: "Anyone with a specific lifecycle stage" },
                  { value: "custom", label: "Custom definition..." },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className="cursor-pointer flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-xl border
                      border-[var(--card-border)] bg-white/40 hover:bg-white/60 transition-colors"
                  >
                    <input
                      type="radio"
                      name="mqlDefinition"
                      value={opt.value}
                      checked={funnel.mqlDefinition === opt.value}
                      onChange={(e) => setFunnel((p) => ({ ...p, mqlDefinition: e.target.value }))}
                      className="cursor-pointer w-4 h-4 accent-[#D06AB8]"
                    />
                    <span className="text-sm pointer-events-none">{opt.label}</span>
                  </label>
                ))}
              </div>
              {funnel.mqlDefinition === "custom" && (
                <input
                  type="text"
                  value={funnel.mqlCustomValue}
                  onChange={(e) => setFunnel((p) => ({ ...p, mqlCustomValue: e.target.value }))}
                  placeholder="Describe your MQL criteria..."
                  className="mt-2 w-full px-4 py-3 min-h-[44px] rounded-xl border border-[var(--card-border)] bg-white/60
                    text-sm placeholder:text-[var(--muted)]/50
                    focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent transition-all"
                />
              )}
            </div>

            <button
              onClick={saveConfig}
              disabled={saving}
              className="cursor-pointer w-full min-h-[44px] rounded-xl text-white font-semibold text-base
                bg-gradient-to-r from-[#6B93D8] via-[#D06AB8] to-[#F04E80]
                hover:opacity-90 active:scale-[0.98] transition-all duration-150
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </span>
              ) : (
                "Save & Connect"
              )}
            </button>
          </div>
        )}

        {/* Step 4: Done */}
        {step === "done" && (
          <div className="lv-card p-8 sm:p-10 animate-fade-in">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[var(--healthy-bg)] mb-6">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[var(--healthy)]">
                  <path
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold gradient-text mb-3">Connected!</h2>
              <p className="text-[var(--muted)] text-sm sm:text-base mb-2">
                Your HubSpot account is linked and ready to go.
              </p>
              <p className="text-sm font-medium text-[var(--foreground)]">
                Found <span className="gradient-text font-bold">{contactCount.toLocaleString()}</span> contacts in your account
              </p>
            </div>
            <a
              href="/leads"
              className="cursor-pointer mt-8 w-full min-h-[44px] rounded-xl text-white font-semibold text-base
                bg-gradient-to-r from-[#6B93D8] via-[#D06AB8] to-[#F04E80]
                hover:opacity-90 active:scale-[0.98] transition-all duration-150
                flex items-center justify-center gap-2"
            >
              Go to Leads
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
