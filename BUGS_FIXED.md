# BUGS_FIXED — Quản Lý GLB

> Rule: mỗi bug do LEAD/AUDIT phát hiện = **thất bại của quy trình test** → BẮT BUỘC thêm test/rule chặn tái diễn trước khi đóng.
> Format: `### B<NN> — <mô tả> [FIXED|PENDING]` · Phát hiện bởi · Nguyên nhân · Fix · **Regression** (test/rule chặn tái diễn).

Counter: B = 1. Last audit: 2026-07-09 (Phase B build).

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

