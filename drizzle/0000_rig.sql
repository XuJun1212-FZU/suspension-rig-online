CREATE TABLE users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE login_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_version INTEGER NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL, updater TEXT NOT NULL, content TEXT NOT NULL, account TEXT NOT NULL REFERENCES users(username), created_at TEXT NOT NULL);
