-- R34 (Mr.Long 11/7) — Duyệt hủy (XÓA qua duyệt) cho TID/POS/Khách/Nhân sự.
-- Thêm 12 quyền + gán: ADMIN (tất cả) · MANAGER (REQUEST+APPROVE cả 4, KHÔNG ELEVATED) ·
-- WAREHOUSE (REQUEST cho TID/POS). Idempotent (ON CONFLICT DO NOTHING) — KHÔNG đụng grant khác.
INSERT INTO "permissions" ("code","name","group") VALUES
  ('TID_CANCEL_REQUEST','Tạo yêu cầu hủy (xóa) TID','TID'),
  ('TID_CANCEL_APPROVE','Duyệt / từ chối yêu cầu hủy TID','TID'),
  ('TID_CANCEL_APPROVE_ELEVATED','Duyệt yêu cầu hủy TID do Quản lý/Admin tạo (cấp Admin)','TID'),
  ('POS_CANCEL_REQUEST','Tạo yêu cầu hủy (xóa) máy POS','POS'),
  ('POS_CANCEL_APPROVE','Duyệt / từ chối yêu cầu hủy máy POS','POS'),
  ('POS_CANCEL_APPROVE_ELEVATED','Duyệt yêu cầu hủy POS do Quản lý/Admin tạo (cấp Admin)','POS'),
  ('CUSTOMER_CANCEL_REQUEST','Tạo yêu cầu hủy (xóa) khách hàng','CUSTOMER'),
  ('CUSTOMER_CANCEL_APPROVE','Duyệt / từ chối yêu cầu hủy khách hàng','CUSTOMER'),
  ('CUSTOMER_CANCEL_APPROVE_ELEVATED','Duyệt yêu cầu hủy khách hàng do Quản lý/Admin tạo (cấp Admin)','CUSTOMER'),
  ('USER_CANCEL_REQUEST','Tạo yêu cầu hủy (xóa) nhân sự','USER'),
  ('USER_CANCEL_APPROVE','Duyệt / từ chối yêu cầu hủy nhân sự','USER'),
  ('USER_CANCEL_APPROVE_ELEVATED','Duyệt yêu cầu hủy nhân sự do Quản lý/Admin tạo (cấp Admin)','USER')
ON CONFLICT ("code") DO NOTHING;

-- ADMIN: tất cả 12 quyền mới.
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON TRUE
WHERE r.code = 'ADMIN' AND p.code IN (
  'TID_CANCEL_REQUEST','TID_CANCEL_APPROVE','TID_CANCEL_APPROVE_ELEVATED',
  'POS_CANCEL_REQUEST','POS_CANCEL_APPROVE','POS_CANCEL_APPROVE_ELEVATED',
  'CUSTOMER_CANCEL_REQUEST','CUSTOMER_CANCEL_APPROVE','CUSTOMER_CANCEL_APPROVE_ELEVATED',
  'USER_CANCEL_REQUEST','USER_CANCEL_APPROVE','USER_CANCEL_APPROVE_ELEVATED')
ON CONFLICT DO NOTHING;

-- MANAGER: REQUEST + APPROVE của cả 4 (KHÔNG ELEVATED).
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON TRUE
WHERE r.code = 'MANAGER' AND p.code IN (
  'TID_CANCEL_REQUEST','TID_CANCEL_APPROVE',
  'POS_CANCEL_REQUEST','POS_CANCEL_APPROVE',
  'CUSTOMER_CANCEL_REQUEST','CUSTOMER_CANCEL_APPROVE',
  'USER_CANCEL_REQUEST','USER_CANCEL_APPROVE')
ON CONFLICT DO NOTHING;

-- WAREHOUSE: TẠO yêu cầu hủy TID/POS (duyệt vẫn do Admin/Manager).
INSERT INTO "role_permissions" ("role_id","permission_id")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON TRUE
WHERE r.code = 'WAREHOUSE' AND p.code IN ('TID_CANCEL_REQUEST','POS_CANCEL_REQUEST')
ON CONFLICT DO NOTHING;
