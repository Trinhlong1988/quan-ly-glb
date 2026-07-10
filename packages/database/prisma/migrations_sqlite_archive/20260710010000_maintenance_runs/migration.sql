-- CreateTable
CREATE TABLE "maintenance_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'OK',
    "checks_total" INTEGER NOT NULL DEFAULT 0,
    "issues_found" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "warn_count" INTEGER NOT NULL DEFAULT 0,
    "report_json" TEXT,
    "backup_file" TEXT,
    "audit_deleted" INTEGER NOT NULL DEFAULT 0,
    "trash_deleted" INTEGER NOT NULL DEFAULT 0,
    "vacuumed" BOOLEAN NOT NULL DEFAULT false,
    "auto_fixed" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "triggered_by" INTEGER,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME
);

-- CreateIndex
CREATE INDEX "maintenance_runs_started_at_idx" ON "maintenance_runs"("started_at");
