CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`access_token` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ads` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`campaign_name` text NOT NULL,
	`adset_id` text NOT NULL,
	`adset_name` text NOT NULL,
	`ad_name` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ad_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`fatigue_score` real NOT NULL,
	`stage` text NOT NULL,
	`signals` text NOT NULL,
	`dismissed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ad_id` text NOT NULL,
	`date` text NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`reach` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`spend` real DEFAULT 0 NOT NULL,
	`frequency` real DEFAULT 0 NOT NULL,
	`ctr` real DEFAULT 0 NOT NULL,
	`cpm` real DEFAULT 0 NOT NULL,
	`cpc` real DEFAULT 0 NOT NULL,
	`actions` integer DEFAULT 0 NOT NULL,
	`cost_per_action` real DEFAULT 0 NOT NULL,
	`conversion_rate` real DEFAULT 0 NOT NULL,
	`inline_post_engagement` integer DEFAULT 0 NOT NULL,
	`post_reactions` integer DEFAULT 0 NOT NULL,
	`post_comments` integer DEFAULT 0 NOT NULL,
	`post_shares` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_metrics_ad_date_idx` ON `daily_metrics` (`ad_id`,`date`);--> statement-breakpoint
CREATE INDEX `daily_metrics_ad_date_desc_idx` ON `daily_metrics` (`ad_id`,`date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`sensitivity_preset` text DEFAULT 'medium' NOT NULL,
	`ctr_weight` real DEFAULT 0.2 NOT NULL,
	`cpm_weight` real DEFAULT 0.15 NOT NULL,
	`frequency_weight` real DEFAULT 0.25 NOT NULL,
	`conversion_weight` real DEFAULT 0.2 NOT NULL,
	`cost_per_result_weight` real DEFAULT 0.1 NOT NULL,
	`engagement_weight` real DEFAULT 0.1 NOT NULL,
	`baseline_window_days` integer DEFAULT 7 NOT NULL,
	`recent_window_days` integer DEFAULT 3 NOT NULL,
	`min_data_days` integer DEFAULT 5 NOT NULL
);
