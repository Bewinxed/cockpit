CREATE TABLE `supervisor_config` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`base_url` text,
	`model` text,
	`api_key` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `supervisor_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`source` text NOT NULL,
	`rule_id` text,
	`verdict` text NOT NULL,
	`message` text,
	`note` text,
	`model` text,
	`latency_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `supervisor_events_instance_created_idx` ON `supervisor_events` (`instance_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `instances` ADD `autopilot` text;--> statement-breakpoint
ALTER TABLE `rules` ADD `trigger` text DEFAULT 'pattern' NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `action` text DEFAULT 'reply' NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `prompt` text;