CREATE TABLE `fleet_agents` (
	`name` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`hash` text NOT NULL,
	`bytes` integer NOT NULL,
	`updated_at` integer NOT NULL
);
