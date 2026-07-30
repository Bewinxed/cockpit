CREATE TABLE `agents` (
	`machine_id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`os` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`blob` text NOT NULL,
	`expires_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`machine_id` text NOT NULL,
	`project_id` text,
	`session_id` text,
	`cwd` text NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `agents`(`machine_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`machine_id` text NOT NULL,
	`name` text NOT NULL,
	`cwd` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `agents`(`machine_id`) ON UPDATE no action ON DELETE no action
);
