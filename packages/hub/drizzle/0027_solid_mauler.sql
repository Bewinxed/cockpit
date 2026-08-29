CREATE TABLE `fleet_hook_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hook_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer NOT NULL,
	`event` text NOT NULL,
	`matcher` text,
	`handler` text NOT NULL,
	`script` text,
	`hash` text NOT NULL,
	`scope` text,
	`project_id` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fleet_hooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`event` text NOT NULL,
	`matcher` text,
	`handler` text NOT NULL,
	`script` text,
	`hash` text NOT NULL,
	`scope` text,
	`project_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);