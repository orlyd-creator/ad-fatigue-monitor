/**
 * Strategist narrative engine — turns an ad's metrics + classification into
 * a multi-sentence brief that reads like a real operator would write it.
 *
 * Deterministic templates that branch on the actual data so each ad gets
 * a specific, useful paragraph (not a one-size-fits-all label).
 */

import type { AdScored } from "./dna";

export interface AdNarrative {
  status: "winner" | "watch" | "fading" | "dead" | "early";
  oneLine: string;       // single-sentence headline
  paragraph: string;     // 3-5 sentence brief
  recommendation: string; // concrete next move
}

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;

export function narrate(ad: AdScored, portfolioCtr: number, portfolioHalfLife: number | null): AdNarrative {
  const c = ad.cls;
  const recentCtr = ad.recentCtr;
  const recentFreq = ad.recentFrequency;
  const days = ad.metrics.length;
  const decay = ad.halfLife.decayedBy || 0;
  const ctrIndex = portfolioCtr > 0 ? recentCtr / portfolioCtr : 1;
  const liftPct = (ctrIndex - 1) * 100;

  // Status decision tree.
  let status: AdNarrative["status"] = "watch";
  if (days < 5) status = "early";
  else if (decay >= 0.4 && recentCtr < portfolioCtr * 0.7) status = "dead";
  else if (decay >= 0.25) status = "fading";
  else if (recentCtr >= portfolioCtr * 1.15) status = "winner";
  else status = "watch";

  // Build the headline.
  const themeStr = c.themeLabel.toLowerCase();
  const treatmentStr = c.treatmentLabel.toLowerCase();
  const audStr = c.audienceLabel.toLowerCase();
  const oneLineByStatus: Record<AdNarrative["status"], string> = {
    winner: `Top ${liftPct.toFixed(0)}% above portfolio CTR — protect this one.`,
    watch:  `Performing roughly in line with portfolio. Hold.`,
    fading: `CTR has decayed ${Math.round(decay * 100)}% from peak. Replacement window is opening.`,
    dead:   `Spent and done. CTR ${Math.round((1 - ctrIndex) * 100)}% below portfolio. Pause.`,
    early:  `Too new to read — only ${days} day${days === 1 ? "" : "s"} of data.`,
  };
  const oneLine = oneLineByStatus[status];

  // Build the paragraph.
  const sentences: string[] = [];

  // Sentence 1: what kind of ad this is, in plain English (so the reader sees pattern + audience together).
  sentences.push(
    `This is a ${themeStr} ad with ${treatmentStr === "default visual" ? "no specific treatment cue in the name" : treatmentStr} targeting your ${audStr === "unspecified" ? "general audience" : audStr} pool.`,
  );

  // Sentence 2: performance vs portfolio, with specific numbers.
  if (status === "early") {
    sentences.push(`Only ${days} day${days === 1 ? "" : "s"} of meaningful data so far — too soon to call it. Recent CTR is ${fmtPct(recentCtr, 2)} but the sample's small.`);
  } else if (status === "winner") {
    const halfLifeNote = ad.halfLife.halfLifeDays
      ? ` Half-life so far is ${ad.halfLife.halfLifeDays} days${portfolioHalfLife ? ` (portfolio averages ${portfolioHalfLife})` : ""}, so the audience hasn't burned out yet.`
      : ` It hasn't decayed measurably yet, so there's runway left.`;
    sentences.push(`CTR is ${fmtPct(recentCtr, 2)} (portfolio averages ${fmtPct(portfolioCtr, 2)}), frequency sits at ${recentFreq.toFixed(1)}×, and you've spent ${fmt$(ad.totalSpend)} on it across ${days} days.${halfLifeNote}`);
  } else if (status === "fading") {
    sentences.push(`CTR has slipped to ${fmtPct(recentCtr, 2)} — about ${Math.round(decay * 100)}% off this ad's own peak. Frequency is ${recentFreq.toFixed(1)}×, daily spend is ${fmt$(ad.dailySpend)}, and you're ${days} days in.`);
  } else if (status === "dead") {
    sentences.push(`Recent CTR is only ${fmtPct(recentCtr, 2)} versus your ${fmtPct(portfolioCtr, 2)} portfolio average, with frequency at ${recentFreq.toFixed(1)}× and ${fmt$(ad.dailySpend)}/day still going to it. The audience is no longer responding.`);
  } else {
    sentences.push(`CTR sits at ${fmtPct(recentCtr, 2)} (portfolio is ${fmtPct(portfolioCtr, 2)}), frequency at ${recentFreq.toFixed(1)}×, and you've put ${fmt$(ad.totalSpend)} behind it over ${days} days.`);
  }

  // Sentence 3: theme-aware context — what the pattern usually does in OD's history.
  if (c.theme === "ai_brand") {
    sentences.push(`AI-tool-led ads have been your most reliable theme historically — they sell the platform via the brand of the model. That's an asset to protect.`);
  } else if (c.theme === "ugc") {
    sentences.push(`UGC creative tends to spike fast and decay fast in this account. Treat the result as a data point, not a strategy — keep two more queued behind every one that ships.`);
  } else if (c.theme === "outcome") {
    sentences.push(`Outcome-led framing ("from X to Y") usually beats feature-led copy in your account when the audience is broad and cold. Lean into the specificity of the outcome number.`);
  } else if (c.theme === "product") {
    sentences.push(`Product-named ads (Cfos / Obol / qbo) work harder for warm/retargeting audiences than for cold broad — the audience needs to already know what the product is.`);
  } else if (c.theme === "problem") {
    sentences.push(`Problem-led framing tends to qualify hard — fewer clicks, but the leads it does drive are usually the highest intent in the account.`);
  } else if (c.theme === "other") {
    sentences.push(`The naming doesn't fit one of your established themes, so this ad is effectively a fresh test. Worth tagging the result clearly so the next round inherits the lesson.`);
  }

  // Sentence 4: what to do, specific to status.
  let recommendation = "";
  if (status === "winner") {
    recommendation = `Increase daily budget by 15–20% (more than that and you'll knock the campaign back into Meta's learning phase). Brief one new variant of this ad — same theme and treatment, fresh hook — so a replacement is queued before the inevitable fatigue.`;
  } else if (status === "fading") {
    recommendation = `Brief a replacement this week — same theme${c.theme === "other" ? "" : ` (${themeStr})`}, different visual or first frame. Keep this one running until the new variant ships, then pause it. Don't let it cross the dead-ad threshold while you're waiting.`;
  } else if (status === "dead") {
    recommendation = `Pause it within the next 24-48 hours and reallocate the ${fmt$(ad.dailySpend)}/day to whichever ad in the same audience is still beating portfolio CTR. Don't refresh this exact creative — the audience has seen it.`;
  } else if (status === "early") {
    recommendation = `Give it another 5-7 days before judging. If CTR settles below ${fmtPct(portfolioCtr * 0.9, 2)}, swap it out; if it lands above ${fmtPct(portfolioCtr * 1.15, 2)}, raise the budget.`;
  } else {
    recommendation = `Hold it. It's not winning, not losing — keep the budget where it is and let it earn or burn its own way to a verdict over the next 5-7 days.`;
  }
  sentences.push(recommendation);

  return {
    status,
    oneLine,
    paragraph: sentences.join(" "),
    recommendation,
  };
}

export function compareWinnerLoser(winner: AdScored, loser: AdScored, portfolioCtr: number): string {
  const wCtr = winner.recentCtr;
  const lCtr = loser.recentCtr;
  const ctrGapPct = lCtr > 0 ? ((wCtr - lCtr) / lCtr) * 100 : 0;

  const sameAudience = winner.cls.audience === loser.cls.audience;
  const themeDiff = winner.cls.theme !== loser.cls.theme;
  const treatmentDiff = winner.cls.treatment !== loser.cls.treatment;

  const sentences: string[] = [];
  sentences.push(
    `The winner is pulling ${fmtPct(wCtr, 2)} CTR vs ${fmtPct(lCtr, 2)} on the loser — about ${ctrGapPct.toFixed(0)}% more clicks per impression for ${fmt$(winner.dailySpend)}/day vs ${fmt$(loser.dailySpend)}/day in spend.`,
  );

  if (sameAudience && themeDiff) {
    sentences.push(
      `Both ads are pointed at your ${winner.cls.audienceLabel.toLowerCase()} audience, so audience is controlled — the difference is the creative angle. The winner is ${winner.cls.themeLabel.toLowerCase()}, the loser is ${loser.cls.themeLabel.toLowerCase()}. That's the lesson to copy: bias the next test toward ${winner.cls.themeLabel.toLowerCase()} framing.`,
    );
  } else if (!sameAudience && !themeDiff) {
    sentences.push(
      `Both ads use the same ${winner.cls.themeLabel.toLowerCase()} angle, so creative is controlled — the spread is audience. The winner is hitting ${winner.cls.audienceLabel.toLowerCase()}, the loser is ${loser.cls.audienceLabel.toLowerCase()}. The next test should bias spend toward the audience that's actually responding.`,
    );
  } else if (themeDiff && treatmentDiff) {
    sentences.push(
      `Two things are different at once — ${winner.cls.themeLabel.toLowerCase()} + ${winner.cls.treatmentLabel.toLowerCase()} on the winner vs ${loser.cls.themeLabel.toLowerCase()} + ${loser.cls.treatmentLabel.toLowerCase()} on the loser. You can't isolate which is doing the work. For the next test, hold the winning theme and vary only the treatment, so you learn which lever is actually pulling.`,
    );
  } else {
    sentences.push(
      `The two ads share most of their classifiable signal, so the gap is probably down to copy specifics or visual hierarchy that the model can't see in the name. Open both, look at the first frame and the headline side-by-side, and write down what's different — that's your test backlog.`,
    );
  }

  sentences.push(
    `Concrete next move: duplicate "${winner.ad.adName}" into a fresh adset, give it 15-20% more daily budget than the loser had, and brief one new variant that keeps the theme but rotates the visual so the audience doesn't see the same thing twice.`,
  );

  return sentences.join(" ");
}
