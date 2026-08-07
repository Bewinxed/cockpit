CREATE TABLE `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`pinned_version` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `tools` text DEFAULT '{}' NOT NULL;