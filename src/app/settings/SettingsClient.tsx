"use client";

import { useState } from "react";

interface SettingsData {
  sensitivityPreset: string; ctrWeight: number; cpmWeight: number; frequencyWeight: number;
  conversionWeight: number; costPerResultWeight: number; engagementWeight: number;
  baselineWindowDays: number; recentWindowDays: number; minDataDays: number;
}

const PRESETS: Record<string, { values: Partial<SettingsData>; desc: string }> = {
  low: { desc: "More tolerant. Good for high-spend accounts.", values: { ctrWeight: 0.15, cpmWeight: 0.10, frequencyWeight: 0.30, conversionWeight: 0.20, costPerResultWeight: 0.15, engagementWeight: 0.10, baselineWindowDays: 10, recentWindowDays: 5, minDataDays: 7 } },
  medium: { desc: "Balanced detection. Works for most accounts.", values: { ctrWeight: 0.20, cpmWeight: 0.15, frequencyWeight: 0.25, conversionWeight: 0.20, costPerResultWeight: 0.10, engagementWeight: 0.10, baselineWindowDays: 7, recentWindowDays: 3, minDataDays: 5 } },
  high: { desc: "Catches fatigue early. More false positives.", values: { ctrWeight: 0.25, cpmWeight: 0.15, frequencyWeight: 0.20, conversionWeight: 0.20, costPerResultWeight: 0.10, engagementWeight: 0.10, baselineWindowDays: 5, recentWindowDays: 2, minDataDays: 3 } },
};

export default function SettingsClient({ initialSettings }: { initialSettings: SettingsData }) {
  const [settings, setSettings] = useState<SettingsData>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handlePresetChange = (preset: string) => {
    if (PRESETS[preset]) setSettings((s) => ({ ...s, ...PRESETS[preset].values, sensitivityPreset: preset }));
  };
  const handleWeightChange = (key: keyof SettingsData, value: number) => {
    setSettings((s) => ({ ...s, [key]: value, sensitivityPreset: "custom" }));
  };
  const handleSave = async () => {
    setSaving(true);
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const totalWeight = settings.ctrWeight + settings.cpmWeight + settings.frequencyWeight + settings.conversionWeight + settings.costPerResultWeight + settings.engagementWeight;

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Settings</h1>
        <p className="text-[14px] text-muted-foreground mt-1">Control how sensitive fatigue detection is. Most people just pick a preset.</p>
      </div>

      {/* Presets */}
      <div className="lv-card p-6 mb-4">
        <h2 className="text-[15px] font-semibold text-foreground mb-1">How sensitive should detection be?</h2>
        <p className="text-[13px] text-muted-foreground mb-5">Higher sensitivity catches problems earlier, but might flag normal fluctuations.</p>
        <div className="grid grid-cols-3 gap-3">
          {(["low", "medium", "high"] as const).map((preset) => (
            <button key={preset} onClick={() => handlePresetChange(preset)}
              className={`rounded-2xl p-4 text-left transition-all border ${
                settings.sensitivityPreset === preset
                  ? "border-[#9b87f5] bg-accent-light shadow-md shadow-purple-100"
                  : "border-transparent bg-surface hover:bg-gray-100"}`}>
              <div className="text-[14px] font-semibold text-foreground capitalize mb-1">{preset}</div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">{PRESETS[preset].desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Weights */}
      <div className="lv-card p-6 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[15px] font-semibold text-foreground">Signal weights</h2>
          <span className={`text-[12px] font-semibold tabular-nums ${Math.abs(totalWeight - 1.0) < 0.01 ? "text-green-500" : "text-amber-500"}`}>
            {(totalWeight * 100).toFixed(0)}% total
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground mb-5">How much each metric matters. Should add up to 100%.</p>
        <div className="space-y-5">
          <WeightSlider label="How often people see it" sublabel="Frequency" value={settings.frequencyWeight} onChange={(v) => handleWeightChange("frequencyWeight", v)} />
          <WeightSlider label="Are people clicking?" sublabel="CTR" value={settings.ctrWeight} onChange={(v) => handleWeightChange("ctrWeight", v)} />
          <WeightSlider label="Are people converting?" sublabel="Conversion Rate" value={settings.conversionWeight} onChange={(v) => handleWeightChange("conversionWeight", v)} />
          <WeightSlider label="Is it getting expensive?" sublabel="CPM" value={settings.cpmWeight} onChange={(v) => handleWeightChange("cpmWeight", v)} />
          <WeightSlider label="What does each result cost?" sublabel="Cost Per Result" value={settings.costPerResultWeight} onChange={(v) => handleWeightChange("costPerResultWeight", v)} />
          <WeightSlider label="Are people engaging?" sublabel="Engagement" value={settings.engagementWeight} onChange={(v) => handleWeightChange("engagementWeight", v)} />
        </div>
      </div>

      {/* Windows */}
      <div className="lv-card p-6 mb-8">
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Analysis windows</h2>
        <p className="text-[13px] text-muted-foreground mb-5">Smaller windows = faster detection but more noise.</p>
        <div className="space-y-4">
          <NumberInput label="Best performance window" sublabel="days to find the peak" value={settings.baselineWindowDays} min={3} max={14}
            onChange={(v) => setSettings((s) => ({ ...s, baselineWindowDays: v, sensitivityPreset: "custom" }))} />
          <NumberInput label="Recent performance window" sublabel="days to compare against" value={settings.recentWindowDays} min={2} max={7}
            onChange={(v) => setSettings((s) => ({ ...s, recentWindowDays: v, sensitivityPreset: "custom" }))} />
          <NumberInput label="Min data before scoring" sublabel="days needed before scoring" value={settings.minDataDays} min={3} max={10}
            onChange={(v) => setSettings((s) => ({ ...s, minDataDays: v, sensitivityPreset: "custom" }))} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className={`px-6 py-2.5 rounded-full text-[14px] font-medium transition-all ${saved
            ? "bg-green-50 text-green-600" : "bg-gradient-to-r from-[#9b87f5] to-[#7E69AB] text-white shadow-lg shadow-purple-200 hover:shadow-xl"}`}>
          {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
        </button>
        <button onClick={() => handlePresetChange("medium")}
          className="px-6 py-2.5 rounded-full text-[14px] font-medium bg-surface hover:bg-gray-200 text-muted-foreground transition-all">
          Reset to Default
        </button>
      </div>
    </main>
  );
}

function WeightSlider({ label, sublabel, value, onChange }: { label: string; sublabel: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div><span className="text-[14px] text-foreground">{label}</span><span className="text-[12px] text-muted ml-2">{sublabel}</span></div>
        <span className="text-[14px] font-semibold text-foreground tabular-nums">{(value * 100).toFixed(0)}%</span>
      </div>
      <input type="range" min={0} max={50} value={value * 100} onChange={(e) => onChange(parseInt(e.target.value) / 100)} className="w-full" />
    </div>
  );
}

function NumberInput({ label, sublabel, value, min, max, onChange }: { label: string; sublabel: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div><div className="text-[14px] text-foreground">{label}</div><div className="text-[12px] text-muted">{sublabel}</div></div>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(min, value - 1))} className="w-8 h-8 rounded-xl bg-surface hover:bg-gray-200 text-foreground text-sm font-medium transition-colors flex items-center justify-center">-</button>
        <span className="w-8 text-center text-[14px] font-semibold text-foreground tabular-nums">{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} className="w-8 h-8 rounded-xl bg-surface hover:bg-gray-200 text-foreground text-sm font-medium transition-colors flex items-center justify-center">+</button>
      </div>
    </div>
  );
}
