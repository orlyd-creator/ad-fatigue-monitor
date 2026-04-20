CREATE TABLE `hubspot_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`atm_property` text DEFAULT 'agreed_to_meet_date___test_' NOT NULL,
	`sql_classification` text DEFAULT 'hs_lead_status_sql' NOT NULL,
	`mql_definition` text DEFAULT 'form_fill' NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `team_invites` (
	`email` text PRIMARY KEY NOT NULL,
	`invited_at` integer NOT NULL,
	`invited_by` text,
	`last_seen_at` integer
);
--> statement-breakpoint
ALTER TABLE `ads` ADD `thumbnail_url` text;--> statement-breakpoint
ALTER TABLE `ads` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `ads` ADD `ad_body` text;--> statement-breakpoint
ALTER TABLE `ads` ADD `ad_headline` text;--> statement-breakpoint
ALTER TABLE `ads` ADD `ad_link_url` text;