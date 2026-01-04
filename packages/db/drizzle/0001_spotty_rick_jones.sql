ALTER TABLE `instances` ADD `sdk_session_id` text;--> statement-breakpoint
CREATE INDEX `instances_sdk_session_id_idx` ON `instances` (`sdk_session_id`);