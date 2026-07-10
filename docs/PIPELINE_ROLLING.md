# PIPELINE CUỐN CHIẾU — hàng đợi thực thi (LEAD điều phối)

> Mục đích: để CMD_BUILD pull tuần tự "cuốn chiếu" mà vẫn tuân **WORKFLOW TỐI THƯỢNG** (freeze tier N trước khi mở tier N+1). Mỗi frame: spec → build → gate độc lập (CMD_AUDIT) → Mr.Long accept (R196) → freeze + tag → mở frame kế.
> LEAD cập nhật cột "Trạng thái" mỗi lần freeze.

| # | Frame | Spec | Gate freeze | Trạng thái |
|---|---|---|---|---|
| F0 | P1.1 giá theo kỳ | `PHASE1_GIA_THEO_KY_SPEC.md` | REV15 73/0 + Prod accept | ✅ FROZEN tag `p1.1-gia-theo-ky` |
| F1 | P1.2 approval + bill bất biến + bulk | `PHASE1_2_APPROVAL_SPEC.md` | typecheck0 / build0 / vitest / selftest18 / REV15 73/0 + Prod accept | 🔶 **ĐANG** — backend xanh, UI CMD_BUILD sửa web-typecheck, **CHƯA freeze** |
| F2 | G10 triển khai đa máy (Postgres LAN + .exe) | `PHASE_G10_DEPLOYMENT_SPEC.md` | §5 G-G10.1..6 + Prod accept LAN thật | ⛔ KHÓA tới khi F1 tag `p1.2` + Mr.Long duyệt §2 |
| F-NOTIF | **Trung tâm Thông báo** (chuông + hòm thư): đẩy sự kiện yêu cầu/duyệt/từ chối hủy bill + user khóa + backup lỗi + công nợ đến hạn | (viết khi tới) | 🆕 Mr.Long chốt 10/7 **TÁCH RIÊNG** khỏi P1.2 — không nối trong F1 |
| F3 | Backlog Nhóm 1 còn lại (ngày dd/mm/yyyy, thùng rác UI, màu button) | `SPEC_V2_GAP_AND_BACKLOG.md` §E1–E4 | (viết khi tới) | ⛔ chờ scope |
| F4 | Backlog Nhóm 2 nền móng (multi-branch, mã CT 6 số, master data kho…) | `SPEC_V2_GAP_AND_BACKLOG.md` §E Nhóm 2 | (viết khi tới) | ⛔ chờ Mr.Long duyệt scope |

## Quy tắc cuốn chiếu
1. CMD_BUILD chỉ được chạm code của frame có trạng thái 🔶 ĐANG. Frame ⛔ = cấm.
2. Mỗi bug CMD_AUDIT bắt trong 1 frame = **thất bại quy trình test** → sửa + bổ sung regression/quy trình (TỐI THƯỢNG GLOBAL) trước khi freeze.
3. LEAD (chỉ LEAD) commit/tag/push. CMD_BUILD CẤM.
4. Sau freeze 1 frame: bump `VERSION.md`, ghi `BUGS_FIXED.md`, đổi trạng thái bảng này, mở frame kế.

## Việc còn treo trong F1 (P1.2) — phải xong trước freeze
- [x] CMD_BUILD sửa `preload/index.d.ts` (bị clobber) → web typecheck 0. **XONG (1147 dòng)**
- [x] Fix root cause emit-trap: outDir 2 tsconfig + gitignore + gate typecheck thật. **XONG (B17)**
- [x] Hardlock: guard + pre-commit hook chống clobber. **XONG, tự-kiểm-thử**
- [x] Xác minh độc lập: typecheck node+web 0 / build 0 / vitest 198 / selftest18 31/0 / REV15 73/0 / guard PASS.
- [x] **Quyết định thông báo** → Mr.Long 10/7: **TÁCH frame F-NOTIF riêng**, KHÔNG nối trong P1.2. Gỡ blocker.
- [ ] Dọn code chết `mode:'edit'` trong TransactionForm (CMD_BUILD, nhỏ) — trước freeze.
- [ ] Cập nhật baseline selftest 27→31 trong VERSION.md khi freeze.
- [ ] **CHỜ Mr.Long: Production accept P1.2 (R196)** → rồi LEAD freeze + tag `p1.2`.
