ALTER TABLE `messages` ADD `sdk_uuid` text;--> statement-breakpoint
CREATE INDEX `messages_sdk_uuid_idx` ON `messages` (`sdk_uuid`);