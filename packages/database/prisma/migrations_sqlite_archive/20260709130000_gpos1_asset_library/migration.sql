-- G-POS.1 — POS/TID asset library (event-sourced) + code counter + mã NV (§A/§D).
-- Additive only: does NOT drop or alter any G1 table beyond adding one nullable column.

-- Mã nhân viên (§D) — nullable + unique.
ALTER TABLE "users" ADD COLUMN "employee_code" TEXT;

-- CreateTable
CREATE TABLE "agents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "customers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "agent_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "pos_devices" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serial" TEXT NOT NULL,
    "model" TEXT,
    "bank" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "current_agent_id" INTEGER,
    "current_customer_id" INTEGER,
    "current_tid" TEXT,
    "warehouse_loc" TEXT,
    "note" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "tids" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tid" TEXT NOT NULL,
    "mid" TEXT,
    "bank" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "pos_serial" TEXT,
    "customer_id" INTEGER,
    "agent_id" INTEGER,
    "opened_at" DATETIME,
    "delivered_at" DATETIME,
    "closed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "device_serial" TEXT,
    "tid" TEXT,
    "event_type" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT,
    "from_agent_id" INTEGER,
    "to_agent_id" INTEGER,
    "customer_id" INTEGER,
    "actor_user_id" INTEGER,
    "occurred_at" DATETIME NOT NULL,
    "note" TEXT,
    "before_json" TEXT,
    "after_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "pos_tid_bindings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pos_serial" TEXT NOT NULL,
    "tid" TEXT NOT NULL,
    "bound_at" DATETIME NOT NULL,
    "unbound_at" DATETIME,
    "unbind_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "code_counters" (
    "prefix" TEXT NOT NULL PRIMARY KEY,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_code_key" ON "users"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "agents_code_key" ON "agents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_devices_serial_key" ON "pos_devices"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "tids_tid_key" ON "tids"("tid");

-- CreateIndex
CREATE INDEX "asset_events_device_serial_idx" ON "asset_events"("device_serial");

-- CreateIndex
CREATE INDEX "asset_events_tid_idx" ON "asset_events"("tid");

-- CreateIndex
CREATE INDEX "pos_tid_bindings_pos_serial_idx" ON "pos_tid_bindings"("pos_serial");

-- CreateIndex
CREATE INDEX "pos_tid_bindings_tid_idx" ON "pos_tid_bindings"("tid");
