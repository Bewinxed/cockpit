DROP INDEX `messages_message_type_idx`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `message_type`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `content`;