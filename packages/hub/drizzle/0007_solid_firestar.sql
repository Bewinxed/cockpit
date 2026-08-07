CREATE TABLE `skills` (
	`name` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`hash` text,
	`bytes` integer,
	`error` text,
	`files` text,
	`created_at` integer NOT NULL
);
