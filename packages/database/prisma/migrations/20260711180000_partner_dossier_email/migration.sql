-- R17: email cho Đối tác. R20: email (địa chỉ email) cho Hồ sơ HKD.
ALTER TABLE "partners" ADD COLUMN "email" TEXT;
ALTER TABLE "dossiers" ADD COLUMN "email" TEXT;
