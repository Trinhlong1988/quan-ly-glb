# BUGS_FIXED — Quản Lý GLB

> Rule: mỗi bug do LEAD/AUDIT phát hiện = **thất bại của quy trình test** → BẮT BUỘC thêm test/rule chặn tái diễn trước khi đóng.
> Format: `### B<NN> — <mô tả> [FIXED|PENDING]` · Phát hiện bởi · Nguyên nhân · Fix · **Regression** (test/rule chặn tái diễn).

Counter: B = 5. Last audit: 2026-07-09 (G-CFG.1 build).

### B01 — Schema Phase A thiếu cột `join_date` (§9 "Ngày vào làm") [FIXED]
- **Phát hiện bởi:** CMD_BUILD khi re-đọc IMS_SPEC §9 lúc dựng form nhân sự Phase B.
- **Nguyên nhân:** Phase A dựng schema 9 bảng nhưng bỏ sót 1 trường optional của form user (§9). Quy trình test Phase A
  chỉ kiểm auth/username — KHÔNG có test đối chiếu đủ trường form §9 với cột DB → lọt.
- **Fix:** thêm `users.joinDate` vào `schema.prisma` + migration `20260709120000_add_user_join_date` + ALTER dev.db
  (qua Electron better-sqlite3) + wire vào CreateUserInput/UpdateUserInput/UserDto + form StaffPage.
- **Regression (chặn tái diễn):** đề xuất CMD_AUDIT thêm 1 test "schema-vs-spec field coverage" — assert mọi trường
  bắt buộc/§9 form user có cột DB tương ứng. Tạm thời: self-test tạo user với đủ trường (birthDate/joinDate) đã cover
  path persist. **Đề xuất quy trình:** mỗi khi thêm form field theo spec, BẮT BUỘC đối chiếu schema trước khi đóng phase.

<!-- Không phát hiện bug logic khác trong Phase B. Self-test 24/24 + Vitest 61/61 PASS. -->

### B02 — Migration history drift: `join_date` không ghi trong `_prisma_migrations` [FIXED]
- **Phát hiện bởi:** CMD_BUILD khi chạy `prisma migrate dev` cho G-POS → Prisma báo "Drift detected" đòi reset DB (mất data).
- **Nguyên nhân:** B01 (Phase B) ALTER dev.db trực tiếp qua Electron better-sqlite3, KHÔNG ghi migration folder vào bảng `_prisma_migrations`. History chỉ có `init` → Prisma coi cột `join_date` là drift thủ công.
- **Fix:** KHÔNG reset (giữ data). `prisma migrate resolve --applied 20260709120000_add_user_join_date` để đánh dấu đã áp dụng, rồi hand-write migration G-POS + `prisma migrate deploy` (additive, không reset).
- **Regression (chặn tái diễn):** **Đề xuất quy trình:** cấm ALTER DB thủ công ngoài `prisma migrate` — mọi thay đổi schema PHẢI qua migration folder + `migrate deploy`/`dev` để history đồng bộ. Nếu buộc ALTER tay, PHẢI `migrate resolve` ngay để ghi history. CMD_AUDIT nên thêm check "migrations folder count == _prisma_migrations rows".

### B03 — Self-test G-POS assert sai thứ tự event do occurredAt backdate không đồng nhất [FIXED]
- **Phát hiện bởi:** CMD_BUILD khi chạy GLB_SELFTEST=3 lần 1 (1/40 FAIL "event types in correct order").
- **Nguyên nhân:** test backdate occurredAt cho 4 transition (2026-07-01..04) nhưng để `createPos` (STOCK_IN) = "now" (2026-07-09). `getDeviceTimeline` sort đúng theo occurredAt (thời gian thao tác thực) nên STOCK_IN rớt xuống cuối — **code đúng, giả định test sai**.
- **Fix:** test truyền `occurredAt` sớm hơn cho createPos (2026-06-01) để dữ liệu nhất quán. KHÔNG sửa code sản phẩm (event-sourcing sort-by-occurredAt là đúng thiết kế §A1).
- **Regression (chặn tái diễn):** self-test đã lock thứ tự 5 event (STOCK_IN→DEPLOY→REPORT_DAMAGE→SEND_REPAIR→RECEIVE_REPAIRED) + assert mọi event có occurredAt hợp lệ. **Bài học:** khi test event-sourced timeline, occurredAt của MỌI event (kể cả create) phải set nhất quán chronological.

### G-POS-A01 — Seed re-sync âm thầm hoàn quyền admin đã gỡ [FIXED — LEAD lock 9/7]
- **Phát hiện bởi:** CMD_AUDIT (đọc `db.ts::seedIfEmpty`). **Luật LEAD 9/7:** *mọi thao tác/sửa đổi ghi log realtime, không xóa được; app KHÔNG tự ý hoàn tác/đổi dữ liệu.*
- **Nguyên nhân:** `seedIfEmpty` upsert `DEFAULT_ROLE_PERMISSIONS` mỗi lần boot với `update:{}` → nếu admin gỡ 1 quyền default khỏi role, reboot `create`-lại quyền đó, **âm thầm, không audit** → vi phạm luật.
- **Fix:** default role-permission chỉ seed khi role **tạo mới lần đầu** (`freshlyCreatedRoleCodes`). Role đã tồn tại → giữ nguyên cấu hình admin đã sửa. Catalog permission/role vẫn upsert tên (an toàn, không phải "revert").
- **Regression (chặn tái diễn):** SELFTEST3 thêm 3 assert — admin gỡ CUSTOMER_CREATE khỏi SALES → re-seed → quyền vẫn bị gỡ (không tự cấp lại) + quyền chưa gỡ giữ nguyên. Chạy trên DB throwaway sạch: **failures=0**.

### B04 — Self-test 2/3 ghi thẳng vào dev.db khi thiếu GLB_DB_URL → nhiễm dữ liệu [FIXED]
- **Phát hiện bởi:** CMD_AUDIT — chạy SELFTEST3 lần 2 FAIL "user creates → DUPLICATE" do lần 1 đã ghi user vào dev.db (không cô lập).
- **Nguyên nhân:** `resolveDatabaseUrl` fallback về dev.db khi `GLB_DB_URL` không set; self-test 2/3 mutate DB nên chạy lặp bị nhiễm, kết quả không lặp lại được (thất bại quy trình test).
- **Fix:** guard trong `index.ts` — SELFTEST=2/3 mà thiếu `GLB_DB_URL` → **ABORT exit 2** kèm hướng dẫn (migrate deploy sang file tạm rồi trỏ GLB_DB_URL). Đã verify: abort đúng, không đụng dev.db.
- **Regression (chặn tái diễn):** **Quy trình chuẩn chạy self-test:** `rm tmp.db && DATABASE_URL=file:tmp.db prisma migrate deploy && GLB_SELFTEST=N GLB_DB_URL=file:tmp.db electron .`. Guard bắt buộc cô lập. **Bài học:** test mutate DB phải chạy trên DB dùng-một-lần, cấm ghi vào DB dev/prod.

### B05 (G-CFG-B01) — Xóa mềm ngân hàng/đối tác rồi tạo lại cùng mã → app CRASH (UnhandledPromiseRejection, IPC treo) [FIXED]
- **Phát hiện bởi:** CMD_AUDIT khi chạy GLB_SELFTEST=4 (kiểm thử 50 đúng/50 sai G-CFG) — `prisma.bank.create()` ném `P2002 Unique constraint failed (code)` **không ai bắt** → promise rejection, IPC không trả kết quả (UI sẽ treo vô hạn).
- **Nguyên nhân:** `Bank.code` và `Partner.code` là `@unique` **toàn cục ở tầng DB** (KHÔNG lọc soft-delete). Nhưng pre-check trùng mã ở service lọc `deletedAt: null` → khi một bản ghi đã xóa mềm (nằm Thùng rác) đang giữ mã đó, pre-check KHÔNG thấy → cho qua → `create()` đụng ràng buộc DB → văng. Nghịch lý với R_TRASH_RESTORE: mã bị "khóa" bởi bản ghi trong thùng rác nhưng người dùng không được cảnh báo, lại còn crash.
- **Fix (`bank-config-service.ts`):** (1) pre-check trùng mã đổi sang **quét TOÀN CỤC** (bỏ `deletedAt:null`) trong create+update của Bank & Partner; phân biệt bản đang sống → `DUPLICATE` vs bản trong thùng rác → `DUPLICATE_TRASH` ("Mã … đang nằm trong Thùng rác. Hãy phục hồi hoặc chọn mã khác."). (2) **Lưới an toàn** `isUniqueViolation(e)` bắt P2002 quanh mọi `create/update` → map về `DUPLICATE` sạch thay vì để văng (phòng race). CardType KHÔNG dính (không có DB-unique, chỉ enforce service); PartnerBank KHÔNG dính (re-link = reactivate row cũ).
- **Regression (chặn tái diễn):** SELFTEST=4 thêm 2 assert `DUPLICATE_TRASH` (tái tạo mã ngân hàng LPB + mã đối tác DT9 đã xóa mềm → chặn sạch, KHÔNG crash). Toàn bộ **109/109 PASS, exit 0, 0 UnhandledPromise**.
- **Đề xuất quy trình (bug class = "unique @DB không lọc soft-delete"):** mọi cột `@unique` trên bảng có `deletedAt` PHẢI: hoặc pre-check toàn cục + phân biệt trạng thái thùng rác, hoặc bọc P2002. CMD_AUDIT thêm bước rà: liệt kê mọi `@unique/@@unique` trên model có `deletedAt`, xác nhận service tương ứng có xử lý va chạm với bản ghi đã xóa mềm. Áp cho các module tương lai (Product/Unit/Warehouse…).

