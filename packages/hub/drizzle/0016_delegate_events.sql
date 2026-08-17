CREATE TABLE `delegate_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`parent_instance_id` text NOT NULL,
	`kind` text NOT NULL,
	`request_id` text,
	`tool_name` text,
	`request_kind` text,
	`payload` text NOT NULL,
	`status` text,
	`created_at` integer NOT NULL
);
