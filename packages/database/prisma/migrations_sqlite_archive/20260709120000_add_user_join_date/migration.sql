-- Add join_date (IMS_SPEC §9 "Ngày vào làm") to users.
ALTER TABLE "users" ADD COLUMN "join_date" DATETIME;
