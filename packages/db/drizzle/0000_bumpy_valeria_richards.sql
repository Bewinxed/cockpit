CREATE TABLE `agents` (
	`machine_id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`tailscale_ip` text NOT NULL,
	`os` text NOT NULL,
	`status` text NOT NULL,
	`last_seen` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agents_status_idx` ON `agents` (`status`);--> statement-breakpoint
CREATE INDEX `agents_last_seen_idx` ON `agents` (`last_seen`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`expires_at` integer,
	`api_key` text,
	`label` text,
	`is_default` integer DEFAULT false,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credentials_type_idx` ON `credentials` (`type`);--> statement-breakpoint
CREATE INDEX `credentials_is_default_idx` ON `credentials` (`is_default`);--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`sdk_session_id` text,
	`project_id` text,
	`machine_id` text NOT NULL,
	`cwd` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`permission_mode` text,
	`last_prompt` text,
	`total_cost_usd` real DEFAULT 0,
	`created_at` integer NOT NULL,
	`stopped_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machine_id`) REFERENCES `agents`(`machine_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `instances_session_id_idx` ON `instances` (`session_id`);--> statement-breakpoint
CREATE INDEX `instances_sdk_session_id_idx` ON `instances` (`sdk_session_id`);--> statement-breakpoint
CREATE INDEX `instances_project_id_idx` ON `instances` (`project_id`);--> statement-breakpoint
CREATE INDEX `instances_machine_id_idx` ON `instances` (`machine_id`);--> statement-breakpoint
CREATE INDEX `instances_status_idx` ON `instances` (`status`);--> statement-breakpoint
CREATE INDEX `instances_created_at_idx` ON `instances` (`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`message_type` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_instance_id_idx` ON `messages` (`instance_id`);--> statement-breakpoint
CREATE INDEX `messages_timestamp_idx` ON `messages` (`timestamp`);--> statement-breakpoint
CREATE INDEX `messages_message_type_idx` ON `messages` (`message_type`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`root_path` text,
	`machine_id` text,
	`settings` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `agents`(`machine_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `projects_machine_id_idx` ON `projects` (`machine_id`);--> statement-breakpoint
CREATE INDEX `projects_name_idx` ON `projects` (`name`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`project_id` text,
	`parent_task_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0,
	`notes` text,
	`metadata` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_instance_id_idx` ON `tasks` (`instance_id`);--> statement-breakpoint
CREATE INDEX `tasks_project_id_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_task_id_idx` ON `tasks` (`parent_task_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_type_idx` ON `tasks` (`type`);