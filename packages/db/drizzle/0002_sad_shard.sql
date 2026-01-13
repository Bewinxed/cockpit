-- Create tool_invocations table
CREATE TABLE `tool_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_input` text,
	`tool_result` text,
	`tool_result_content` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_error` integer DEFAULT false,
	`duration_ms` integer,
	`subagent_type` text,
	`subagent_description` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tool_invocations_message_id_idx` ON `tool_invocations` (`message_id`);
--> statement-breakpoint
CREATE INDEX `tool_invocations_instance_id_idx` ON `tool_invocations` (`instance_id`);
--> statement-breakpoint
CREATE INDEX `tool_invocations_tool_name_idx` ON `tool_invocations` (`tool_name`);
--> statement-breakpoint
CREATE INDEX `tool_invocations_status_idx` ON `tool_invocations` (`status`);
--> statement-breakpoint
CREATE INDEX `tool_invocations_subagent_type_idx` ON `tool_invocations` (`subagent_type`);
--> statement-breakpoint

-- Migrate messages table to new schema
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`sdk_uuid` text,
	`sdk_type` text NOT NULL,
	`sdk_subtype` text,
	`parent_tool_use_id` text,
	`role` text,
	`text_content` text,
	`raw_content` text NOT NULL,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`message_type` text NOT NULL,
	`content` text,
	`timestamp` integer NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint

-- Copy existing data with sensible defaults for new columns
-- raw_content gets the old content value, sdk_type derived from message_type
INSERT INTO `__new_messages`(
	"id", "instance_id", "sdk_uuid", "sdk_type", "sdk_subtype", "parent_tool_use_id",
	"role", "text_content", "raw_content", "model", "input_tokens", "output_tokens",
	"cost_usd", "message_type", "content", "timestamp", "created_at"
)
SELECT
	"id",
	"instance_id",
	"sdk_uuid",
	-- Map old message_type to new sdk_type
	CASE
		WHEN "message_type" = 'user' THEN 'user'
		WHEN "message_type" = 'assistant' THEN 'assistant'
		WHEN "message_type" = 'system' THEN 'system'
		WHEN "message_type" = 'tool_use' THEN 'assistant'
		WHEN "message_type" = 'tool_result' THEN 'result'
		ELSE 'user'
	END as "sdk_type",
	NULL as "sdk_subtype",
	NULL as "parent_tool_use_id",
	-- Map role from message_type
	CASE
		WHEN "message_type" IN ('user', 'system') THEN 'user'
		WHEN "message_type" IN ('assistant', 'tool_use') THEN 'assistant'
		ELSE NULL
	END as "role",
	NULL as "text_content",
	"content" as "raw_content",  -- Copy content to raw_content
	NULL as "model",
	NULL as "input_tokens",
	NULL as "output_tokens",
	NULL as "cost_usd",
	"message_type",
	"content",
	"timestamp",
	"timestamp" as "created_at"  -- Use timestamp as created_at for existing rows
FROM `messages`;
--> statement-breakpoint
DROP TABLE `messages`;
--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint

-- Create indexes for messages
CREATE UNIQUE INDEX `messages_sdk_uuid_unique` ON `messages` (`sdk_uuid`);
--> statement-breakpoint
CREATE INDEX `messages_instance_id_idx` ON `messages` (`instance_id`);
--> statement-breakpoint
CREATE INDEX `messages_timestamp_idx` ON `messages` (`timestamp`);
--> statement-breakpoint
CREATE INDEX `messages_message_type_idx` ON `messages` (`message_type`);
--> statement-breakpoint
CREATE INDEX `messages_sdk_uuid_idx` ON `messages` (`sdk_uuid`);
--> statement-breakpoint
CREATE INDEX `messages_parent_tool_use_id_idx` ON `messages` (`parent_tool_use_id`);
--> statement-breakpoint
CREATE INDEX `messages_sdk_type_idx` ON `messages` (`sdk_type`);
--> statement-breakpoint
CREATE INDEX `messages_role_idx` ON `messages` (`role`);
