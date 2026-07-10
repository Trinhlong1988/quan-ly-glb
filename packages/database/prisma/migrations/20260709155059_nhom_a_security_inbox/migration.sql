-- CreateTable
CREATE TABLE "messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL DEFAULT 'USER',
    "category" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sender_id" INTEGER,
    "recipient_id" INTEGER NOT NULL,
    "read_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employee_code" TEXT,
    "full_name" TEXT NOT NULL,
    "birth_date" DATETIME,
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "join_date" DATETIME,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "force_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" DATETIME,
    "level2_hash" TEXT,
    "level2_set_at" DATETIME,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);
INSERT INTO "new_users" ("address", "birth_date", "created_at", "created_by", "deleted_at", "email", "employee_code", "force_change_password", "full_name", "gender", "id", "join_date", "password_hash", "phone", "status", "updated_at", "username") SELECT "address", "birth_date", "created_at", "created_by", "deleted_at", "email", "employee_code", "force_change_password", "full_name", "gender", "id", "join_date", "password_hash", "phone", "status", "updated_at", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_employee_code_key" ON "users"("employee_code");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "messages_recipient_id_deleted_at_idx" ON "messages"("recipient_id", "deleted_at");
