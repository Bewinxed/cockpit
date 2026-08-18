CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`pattern` text NOT NULL,
	`match_kind` text DEFAULT 'phrase' NOT NULL,
	`case_sensitive` integer DEFAULT false NOT NULL,
	`whole_word` integer DEFAULT false NOT NULL,
	`watch` text DEFAULT 'text' NOT NULL,
	`reply` text NOT NULL,
	`timing` text DEFAULT 'turn' NOT NULL,
	`interrupt` integer DEFAULT false NOT NULL,
	`require_ack` integer DEFAULT true NOT NULL,
	`scope` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rule_state` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`status` text DEFAULT 'armed' NOT NULL,
	`fire_count` integer DEFAULT 0 NOT NULL,
	`total_fires` integer DEFAULT 0 NOT NULL,
	`last_fired_at` integer,
	`acked_at` integer,
	`ack_note` text
);
--> statement-breakpoint
CREATE INDEX `rule_state_rule_idx` ON `rule_state` (`rule_id`);--> statement-breakpoint
CREATE INDEX `rule_state_instance_idx` ON `rule_state` (`instance_id`);
