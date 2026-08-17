CREATE TABLE `usage_limits` (
	`machine_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` integer NOT NULL
);
