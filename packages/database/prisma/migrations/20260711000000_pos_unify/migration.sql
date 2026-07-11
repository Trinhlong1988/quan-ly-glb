-- PHASE K1 — Hợp nhất POS: PosDevice = nguồn sự thật DUY NHẤT của 1 máy (Q-P1).
-- Thêm cột nhập di trú từ PosIntake (nullable — KHÔNG phá dữ liệu cũ) + audit + soft-delete.
-- GIỮ cột model/bank text (Q-P4, không xóa ở pha K). Backfill dữ liệu chạy ở seedIfEmpty
--   (backfillPosDevicesFromIntakes) — idempotent, guard cờ AppSetting (giống grant*IfMissing).

-- AlterTable — pos_devices: cột nhập di trú + FK scalar.
ALTER TABLE "pos_devices" ADD COLUMN "pos_model_id" INTEGER;
ALTER TABLE "pos_devices" ADD COLUMN "supplier_id" INTEGER;
ALTER TABLE "pos_devices" ADD COLUMN "intake_status_id" INTEGER;
ALTER TABLE "pos_devices" ADD COLUMN "import_price" INTEGER;
ALTER TABLE "pos_devices" ADD COLUMN "imported_at" TIMESTAMPTZ(3);
ALTER TABLE "pos_devices" ADD COLUMN "bank_id" INTEGER;

-- AlterTable — pos_devices: audit + soft-delete (trước đây thiếu).
ALTER TABLE "pos_devices" ADD COLUMN "created_by" INTEGER;
ALTER TABLE "pos_devices" ADD COLUMN "updated_by" INTEGER;
ALTER TABLE "pos_devices" ADD COLUMN "deleted_by" INTEGER;
ALTER TABLE "pos_devices" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "pos_devices_pos_model_id_idx" ON "pos_devices"("pos_model_id");
CREATE INDEX "pos_devices_supplier_id_idx" ON "pos_devices"("supplier_id");
