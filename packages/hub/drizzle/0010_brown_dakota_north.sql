CREATE TABLE `fleet_memory_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`hash` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
