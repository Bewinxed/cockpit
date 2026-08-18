CREATE TABLE `fleet_memory_docs` (
	`path` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `fleet_memory_history` ADD `path` text;
