ALTER TABLE users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0;
