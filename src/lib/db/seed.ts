import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { format, subDays } from "date-fns";
import path from "path";

const dbPath = path.join(process.cwd(), "sqlite.db");
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

// Seed demo data
function seed() {
  console.log("Seeding demo data...");

  // Create a demo account
  db.insert(schema.accounts)
    .values({
      id: "demo_account",
      name: "Demo Ad Account",
      accessToken: "demo_token",
      tokenExpiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      userId: "demo_user",
    })
    .onConflictDoUpdate({
      target: schema.accounts.id,
      set: { name: "Demo Ad Account" },
    })
    .run();

  // Create demo ads
  const demoAds = [
    { id: "ad_001", name: "Summer Sale - Video Creative", campaign: "Summer Sale 2024", adset: "Broad Audience 25-44", status: "ACTIVE" },
    { id: "ad_002", name: "Product Launch - Carousel", campaign: "New Product Launch", adset: "Lookalike Audience", status: "ACTIVE" },
    { id: "ad_003", name: "Brand Awareness - Static Image", campaign: "Brand Awareness Q2", adset: "Interest: Fashion", status: "ACTIVE" },
    { id: "ad_004", name: "Retargeting - Dynamic Product", campaign: "Retargeting Campaigns", adset: "Website Visitors 30d", status: "ACTIVE" },
    { id: "ad_005", name: "Lead Gen - Free Trial Offer", campaign: "Lead Generation", adset: "Custom Audience: Email List", status: "ACTIVE" },
    { id: "ad_006", name: "Testimonial Video Ad", campaign: "Social Proof Campaign", adset: "Broad Audience 18-34", status: "ACTIVE" },
    { id: "ad_007", name: "Holiday Promo - Flash Sale", campaign: "Seasonal Promotions", adset: "High-Value Customers", status: "ACTIVE" },
    { id: "ad_008", name: "New Feature Announcement", campaign: "Product Updates", adset: "Existing Customers", status: "ACTIVE" },
  ];

  for (const ad of demoAds) {
    db.insert(schema.ads)
      .values({
        id: ad.id,
        accountId: "demo_account",
        campaignId: `camp_${ad.id}`,
        campaignName: ad.campaign,
        adsetId: `adset_${ad.id}`,
        adsetName: ad.adset,
        adName: ad.name,
        status: ad.status,
        lastSyncedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: schema.ads.id,
        set: { adName: ad.name, lastSyncedAt: Date.now() },
      })
      .run();
  }

  // Generate 20 days of metrics for each ad with different fatigue patterns
  const now = new Date();

  // Ad 1: HEALTHY - stable good performance
  generateMetrics("ad_001", {
    baseCtr: 2.5,
    baseCpm: 12,
    baseFreq: 1.5,
    baseConvRate: 0.08,
    baseEngagement: 45,
    ctrTrend: 0.02,    // slight improvement
    cpmTrend: -0.1,
    freqGrowth: 0.03,
    convTrend: 0.01,
    engTrend: 0.5,
  });

  // Ad 2: EARLY WARNING - starting to show signs
  generateMetrics("ad_002", {
    baseCtr: 3.0,
    baseCpm: 15,
    baseFreq: 2.0,
    baseConvRate: 0.06,
    baseEngagement: 60,
    ctrTrend: -0.06,   // CTR declining
    cpmTrend: 0.3,     // CPM rising slightly
    freqGrowth: 0.12,  // frequency climbing
    convTrend: -0.002,
    engTrend: -1.0,
  });

  // Ad 3: FATIGUING - clear fatigue signals
  generateMetrics("ad_003", {
    baseCtr: 2.8,
    baseCpm: 10,
    baseFreq: 2.5,
    baseConvRate: 0.05,
    baseEngagement: 35,
    ctrTrend: -0.1,    // strong CTR decline
    cpmTrend: 0.6,     // CPM climbing fast
    freqGrowth: 0.18,  // frequency getting high
    convTrend: -0.003,
    engTrend: -2.0,
  });

  // Ad 4: FATIGUED - severe fatigue
  generateMetrics("ad_004", {
    baseCtr: 3.5,
    baseCpm: 8,
    baseFreq: 3.0,
    baseConvRate: 0.10,
    baseEngagement: 80,
    ctrTrend: -0.15,   // CTR tanking
    cpmTrend: 1.2,     // CPM spiking
    freqGrowth: 0.25,  // frequency very high
    convTrend: -0.005,
    engTrend: -4.0,
  });

  // Ad 5: HEALTHY - new ad, doing great
  generateMetrics("ad_005", {
    baseCtr: 4.0,
    baseCpm: 14,
    baseFreq: 1.2,
    baseConvRate: 0.12,
    baseEngagement: 90,
    ctrTrend: 0.05,
    cpmTrend: -0.2,
    freqGrowth: 0.02,
    convTrend: 0.002,
    engTrend: 1.0,
  });

  // Ad 6: EARLY WARNING - engagement dropping
  generateMetrics("ad_006", {
    baseCtr: 2.2,
    baseCpm: 11,
    baseFreq: 2.2,
    baseConvRate: 0.04,
    baseEngagement: 55,
    ctrTrend: -0.04,
    cpmTrend: 0.2,
    freqGrowth: 0.10,
    convTrend: -0.001,
    engTrend: -2.5,
  });

  // Ad 7: FATIGUING - costs rising fast
  generateMetrics("ad_007", {
    baseCtr: 2.0,
    baseCpm: 18,
    baseFreq: 2.8,
    baseConvRate: 0.07,
    baseEngagement: 40,
    ctrTrend: -0.08,
    cpmTrend: 0.8,
    freqGrowth: 0.15,
    convTrend: -0.004,
    engTrend: -1.5,
  });

  // Ad 8: HEALTHY - just launched
  generateMetrics("ad_008", {
    baseCtr: 3.2,
    baseCpm: 9,
    baseFreq: 1.0,
    baseConvRate: 0.09,
    baseEngagement: 70,
    ctrTrend: 0.01,
    cpmTrend: 0.0,
    freqGrowth: 0.04,
    convTrend: 0.001,
    engTrend: 0.3,
  }, 8); // only 8 days of data

  // Create some alerts
  db.insert(schema.alerts)
    .values([
      {
        adId: "ad_004",
        fatigueScore: 82,
        stage: "fatigued",
        signals: JSON.stringify([
          { name: "ctr_decline", label: "CTR Decline", score: 78, weight: 0.20 },
          { name: "frequency", label: "Frequency", score: 90, weight: 0.25 },
          { name: "cpm_rising", label: "CPM Rising", score: 85, weight: 0.15 },
        ]),
        createdAt: Date.now() - 2 * 60 * 60 * 1000,
      },
      {
        adId: "ad_003",
        fatigueScore: 58,
        stage: "fatiguing",
        signals: JSON.stringify([
          { name: "ctr_decline", label: "CTR Decline", score: 62, weight: 0.20 },
          { name: "frequency", label: "Frequency", score: 55, weight: 0.25 },
        ]),
        createdAt: Date.now() - 6 * 60 * 60 * 1000,
      },
      {
        adId: "ad_002",
        fatigueScore: 35,
        stage: "early_warning",
        signals: JSON.stringify([
          { name: "frequency", label: "Frequency", score: 42, weight: 0.25 },
          { name: "engagement_decay", label: "Engagement", score: 38, weight: 0.10 },
        ]),
        createdAt: Date.now() - 12 * 60 * 60 * 1000,
      },
      {
        adId: "ad_007",
        fatigueScore: 55,
        stage: "fatiguing",
        signals: JSON.stringify([
          { name: "cpm_rising", label: "CPM Rising", score: 70, weight: 0.15 },
          { name: "frequency", label: "Frequency", score: 60, weight: 0.25 },
        ]),
        createdAt: Date.now() - 18 * 60 * 60 * 1000,
      },
      {
        adId: "ad_006",
        fatigueScore: 30,
        stage: "early_warning",
        signals: JSON.stringify([
          { name: "engagement_decay", label: "Engagement", score: 50, weight: 0.10 },
          { name: "frequency", label: "Frequency", score: 35, weight: 0.25 },
        ]),
        createdAt: Date.now() - 24 * 60 * 60 * 1000,
      },
    ])
    .run();

  // Create default settings
  db.insert(schema.settings)
    .values({ id: 1 })
    .onConflictDoUpdate({ target: schema.settings.id, set: { sensitivityPreset: "medium" } })
    .run();

  console.log("Demo data seeded successfully!");
  console.log("  - 1 demo account");
  console.log("  - 8 demo ads with varying fatigue levels");
  console.log("  - 5 alerts");

  function generateMetrics(
    adId: string,
    params: {
      baseCtr: number;
      baseCpm: number;
      baseFreq: number;
      baseConvRate: number;
      baseEngagement: number;
      ctrTrend: number;
      cpmTrend: number;
      freqGrowth: number;
      convTrend: number;
      engTrend: number;
    },
    days = 20
  ) {
    for (let d = days - 1; d >= 0; d--) {
      const date = format(subDays(now, d), "yyyy-MM-dd");
      const dayIndex = days - 1 - d;
      const noise = () => (Math.random() - 0.5) * 0.3;

      const ctr = Math.max(0.1, params.baseCtr + params.ctrTrend * dayIndex + noise() * 0.5);
      const cpm = Math.max(1, params.baseCpm + params.cpmTrend * dayIndex + noise() * 2);
      const frequency = Math.max(1, params.baseFreq + params.freqGrowth * dayIndex + noise() * 0.1);
      const convRate = Math.max(0, params.baseConvRate + params.convTrend * dayIndex + noise() * 0.01);
      const impressions = Math.round(5000 + Math.random() * 10000);
      const clicks = Math.round(impressions * (ctr / 100));
      const spend = impressions * (cpm / 1000);
      const actions = Math.round(clicks * convRate);
      const engagement = Math.max(0, Math.round(params.baseEngagement + params.engTrend * dayIndex + noise() * 5));

      db.insert(schema.dailyMetrics)
        .values({
          adId,
          date,
          impressions,
          reach: Math.round(impressions / frequency),
          clicks,
          spend: Math.round(spend * 100) / 100,
          frequency: Math.round(frequency * 100) / 100,
          ctr: Math.round(ctr * 100) / 100,
          cpm: Math.round(cpm * 100) / 100,
          cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
          actions,
          costPerAction: actions > 0 ? Math.round((spend / actions) * 100) / 100 : 0,
          conversionRate: Math.round(convRate * 10000) / 10000,
          inlinePostEngagement: engagement,
          postReactions: Math.round(engagement * 0.6),
          postComments: Math.round(engagement * 0.25),
          postShares: Math.round(engagement * 0.15),
        })
        .onConflictDoUpdate({
          target: [schema.dailyMetrics.adId, schema.dailyMetrics.date],
          set: { impressions }, // just update something to avoid error
        })
        .run();
    }
  }
}

seed();
sqlite.close();
