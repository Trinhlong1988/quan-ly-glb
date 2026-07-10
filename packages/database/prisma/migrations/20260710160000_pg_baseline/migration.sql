-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "employee_code" TEXT,
    "full_name" TEXT NOT NULL,
    "birth_date" TIMESTAMP(3),
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "join_date" TIMESTAMP(3),
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "force_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(3),
    "level2_hash" TEXT,
    "level2_set_at" TIMESTAMPTZ(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'USER',
    "category" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sender_id" INTEGER,
    "recipient_id" INTEGER NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "group" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "before_json" TEXT,
    "after_json" TEXT,
    "ip_address" TEXT,
    "device_info" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_logs" (
    "id" SERIAL NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER,
    "checksum" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "backup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_sessions" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "agent_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_devices" (
    "id" SERIAL NOT NULL,
    "serial" TEXT NOT NULL,
    "model" TEXT,
    "bank" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "current_agent_id" INTEGER,
    "current_customer_id" INTEGER,
    "current_tid" TEXT,
    "warehouse_loc" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pos_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tids" (
    "id" SERIAL NOT NULL,
    "tid" TEXT NOT NULL,
    "mid" TEXT,
    "bank" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "pos_serial" TEXT,
    "customer_id" INTEGER,
    "agent_id" INTEGER,
    "opened_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "bank_id" INTEGER,
    "partner_id" INTEGER,
    "hkd_name" TEXT,
    "receive_account_id" INTEGER,
    "issued_at" TIMESTAMPTZ(3),
    "config_status_id" INTEGER,
    "dossier_source_id" INTEGER,
    "note" TEXT,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "tid_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "card_type_id" INTEGER,
    "amount" INTEGER NOT NULL,
    "partner_margin_milli" INTEGER NOT NULL DEFAULT 0,
    "sell_margin_milli" INTEGER NOT NULL DEFAULT 0,
    "revenue_partner" INTEGER NOT NULL DEFAULT 0,
    "revenue_sell" INTEGER NOT NULL DEFAULT 0,
    "revenue_amount" INTEGER NOT NULL DEFAULT 0,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "settled_at" TIMESTAMPTZ(3),
    "txn_date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_request_id" INTEGER,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" SERIAL NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by" INTEGER NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" INTEGER,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tid_config_statuses" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "tid_config_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" SERIAL NOT NULL,
    "device_serial" TEXT,
    "tid" TEXT,
    "event_type" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT,
    "from_agent_id" INTEGER,
    "to_agent_id" INTEGER,
    "customer_id" INTEGER,
    "actor_user_id" INTEGER,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "before_json" TEXT,
    "after_json" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_tid_bindings" (
    "id" SERIAL NOT NULL,
    "pos_serial" TEXT NOT NULL,
    "tid" TEXT NOT NULL,
    "bound_at" TIMESTAMPTZ(3) NOT NULL,
    "unbound_at" TIMESTAMPTZ(3),
    "unbind_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_tid_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_counters" (
    "prefix" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "code_counters_pkey" PRIMARY KEY ("prefix")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_types" (
    "id" SERIAL NOT NULL,
    "bank_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "card_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "contact_person" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_banks" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "bank_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "partner_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "contact_person" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_models" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "pos_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_intake_statuses" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "pos_intake_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_intakes" (
    "id" SERIAL NOT NULL,
    "pos_model_id" INTEGER NOT NULL,
    "serial" TEXT NOT NULL,
    "intake_status_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "import_price" INTEGER NOT NULL,
    "imported_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "pos_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "fee_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rates" (
    "id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "card_type_id" INTEGER NOT NULL,
    "phi_mua" INTEGER NOT NULL,
    "phi_cai_may" INTEGER NOT NULL,
    "phi_ban" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "fee_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receive_account_sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "receive_account_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receive_accounts" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_id" INTEGER NOT NULL,
    "branch" TEXT,
    "cccd_number" TEXT,
    "cccd_issue_date" TIMESTAMP(3),
    "cccd_issue_place" TEXT,
    "cccd_expiry" TIMESTAMP(3),
    "phone" TEXT,
    "email" TEXT,
    "customer_id" INTEGER,
    "cccd_front_path" TEXT,
    "cccd_front_name" TEXT,
    "cccd_back_path" TEXT,
    "cccd_back_name" TEXT,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "receive_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dossier_sources" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "discount_rate" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "dossier_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dossiers" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "hkd_name" TEXT NOT NULL,
    "hkd_address" TEXT,
    "tax_code" TEXT,
    "dkkd_issue_date" TIMESTAMP(3),
    "dkkd_issue_place" TEXT,
    "owner_name" TEXT NOT NULL,
    "gender" TEXT,
    "ethnicity" TEXT,
    "cccd_number" TEXT,
    "cccd_issue_date" TIMESTAMP(3),
    "cccd_issue_place" TEXT,
    "cccd_expiry" TIMESTAMP(3),
    "permanent_address" TEXT,
    "current_address" TEXT,
    "dkkd_front_path" TEXT,
    "dkkd_front_name" TEXT,
    "dkkd_back_path" TEXT,
    "dkkd_back_name" TEXT,
    "cccd_front_path" TEXT,
    "cccd_front_name" TEXT,
    "cccd_back_path" TEXT,
    "cccd_back_name" TEXT,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "dossiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_runs" (
    "id" SERIAL NOT NULL,
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
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "maintenance_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_code_key" ON "users"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "messages_recipient_id_deleted_at_idx" ON "messages"("recipient_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_key_key" ON "app_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "agents_code_key" ON "agents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_devices_serial_key" ON "pos_devices"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "tids_tid_key" ON "tids"("tid");

-- CreateIndex
CREATE INDEX "tids_partner_id_idx" ON "tids"("partner_id");

-- CreateIndex
CREATE INDEX "tids_bank_id_idx" ON "tids"("bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_code_key" ON "transactions"("code");

-- CreateIndex
CREATE INDEX "transactions_tid_id_idx" ON "transactions"("tid_id");

-- CreateIndex
CREATE INDEX "transactions_customer_id_idx" ON "transactions"("customer_id");

-- CreateIndex
CREATE INDEX "transactions_txn_date_idx" ON "transactions"("txn_date");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "approval_requests_entity_type_entity_id_idx" ON "approval_requests"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tid_config_statuses_name_key" ON "tid_config_statuses"("name");

-- CreateIndex
CREATE INDEX "asset_events_device_serial_idx" ON "asset_events"("device_serial");

-- CreateIndex
CREATE INDEX "asset_events_tid_idx" ON "asset_events"("tid");

-- CreateIndex
CREATE INDEX "pos_tid_bindings_pos_serial_idx" ON "pos_tid_bindings"("pos_serial");

-- CreateIndex
CREATE INDEX "pos_tid_bindings_tid_idx" ON "pos_tid_bindings"("tid");

-- CreateIndex
CREATE UNIQUE INDEX "banks_code_key" ON "banks"("code");

-- CreateIndex
CREATE INDEX "card_types_bank_id_idx" ON "card_types"("bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "partner_banks_partner_id_idx" ON "partner_banks"("partner_id");

-- CreateIndex
CREATE INDEX "partner_banks_bank_id_idx" ON "partner_banks"("bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_banks_partner_id_bank_id_key" ON "partner_banks"("partner_id", "bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_models_code_key" ON "pos_models"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pos_intake_statuses_name_key" ON "pos_intake_statuses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pos_intakes_serial_key" ON "pos_intakes"("serial");

-- CreateIndex
CREATE INDEX "pos_intakes_pos_model_id_idx" ON "pos_intakes"("pos_model_id");

-- CreateIndex
CREATE INDEX "pos_intakes_supplier_id_idx" ON "pos_intakes"("supplier_id");

-- CreateIndex
CREATE INDEX "pos_intakes_intake_status_id_idx" ON "pos_intakes"("intake_status_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_types_name_key" ON "fee_types"("name");

-- CreateIndex
CREATE INDEX "fee_rates_partner_id_idx" ON "fee_rates"("partner_id");

-- CreateIndex
CREATE INDEX "fee_rates_card_type_id_idx" ON "fee_rates"("card_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "receive_account_sources_name_key" ON "receive_account_sources"("name");

-- CreateIndex
CREATE INDEX "receive_accounts_source_id_idx" ON "receive_accounts"("source_id");

-- CreateIndex
CREATE INDEX "receive_accounts_bank_id_idx" ON "receive_accounts"("bank_id");

-- CreateIndex
CREATE INDEX "receive_accounts_customer_id_idx" ON "receive_accounts"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "dossier_sources_code_key" ON "dossier_sources"("code");

-- CreateIndex
CREATE INDEX "dossiers_source_id_idx" ON "dossiers"("source_id");

-- CreateIndex
CREATE INDEX "maintenance_runs_started_at_idx" ON "maintenance_runs"("started_at");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

