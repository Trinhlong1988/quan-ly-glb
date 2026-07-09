# BUGS_FIXED — Quản Lý GLB

> Rule: mỗi bug do LEAD/AUDIT phát hiện = **thất bại của quy trình test** → BẮT BUỘC thêm test/rule chặn tái diễn trước khi đóng.
> Format: `### B<NN> — <mô tả> [FIXED|PENDING]` · Phát hiện bởi · Nguyên nhân · Fix · **Regression** (test/rule chặn tái diễn).

Counter: B = 3. Last audit: 2026-07-09 (G-POS.1 build).

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

