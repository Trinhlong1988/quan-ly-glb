-- AlterTable
ALTER TABLE "agents" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "banks" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "card_types" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "dossier_sources" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "dossiers" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "fee_rates" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "fee_types" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "partners" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "pos_intake_statuses" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "pos_intakes" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "pos_models" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "receive_account_sources" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "receive_accounts" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "tid_config_statuses" ADD COLUMN "deleted_by" INTEGER;

-- AlterTable
ALTER TABLE "tids" ADD COLUMN "deleted_by" INTEGER;
