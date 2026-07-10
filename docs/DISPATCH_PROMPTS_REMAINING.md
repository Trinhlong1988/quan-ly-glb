# BỘ PROMPT DISPATCH TUẦN TỰ — các frame còn lại (LEAD soạn, QA agent phản biện trước khi chạy)

> Mỗi prompt tuân `CMD_BUILD_DISPATCH_PROTOCOL.md` (5 khối). Thứ tự freeze: F-NOTIF → G10 → F3 → F4. Mỗi frame chỉ chạy khi frame trước đã tag + (nếu có) Mr.Long chốt quyết định TENTATIVE.
> **Trạng thái quyết định:** F-NOTIF không cần quyết định infra → chạy được ngay. G10 **KHÓA** tới khi Mr.Long chốt Q1–Q6 (xem PHASE_G10_DEPLOYMENT_SPEC §2).

---

## PROMPT F-NOTIF — Đẩy thông báo sự kiện hủy bill vào hòm thư (UI đã có)

> **Đã sửa theo QA phản biện 10/7** (#1 sai file mầm, #2 UI đã tồn tại, #3 sai quyền người nhận, #5 thiếu emit-trap, #6 thiếu regression approval).

**① Vai + repo:** Bạn = CMD_BUILD. Chỉ sửa ổ D `D:\TT HKD AI\tools\quan-ly-glb`. CẤM đụng bản C. CẤM git commit/tag/push. Bất định → DỪNG hỏi, KHÔNG đoán. Đọc trước: `docs/CMD_BUILD_DISPATCH_PROTOCOL.md`, `VERSION.md`, `BUGS_FIXED.md`.
- **Sự thật hạ tầng (đã QA verify — đừng làm lại):** chuông + badge chưa-đọc + panel hòm thư **ĐÃ CHẠY THẬT** (`Dashboard.tsx` `unread`/`messageUnreadCount` + `MessagesDrawer.tsx`). Mầm thông báo hệ thống = **`message-service.ts`** (bảng `messages`, `kind='SYSTEM'`, `senderId=null`, `recipientId`). **`notification-service.ts` KHÔNG liên quan** (nó là stub Zalo/TID-chưa-giao — CẤM đụng).

**② Đo lường trước bug (gate phòng ngừa):**
- `emit-trap`: verify LUÔN qua `npm run typecheck` (--noEmit). **CẤM `tsc -p` trần.** Sau verify `git status` phải sạch (không phun `.js/.d.ts` vào `src/`).
- `type-mirror-drift`: nếu thêm DTO vào `preload/index.d.ts` → web typecheck 0 + `audit:protected` PASS. CHỈ Edit chèn, KHÔNG Write đè.
- `permission-leak` (QA #3): **KHÔNG reuse `notifyAdmins`** (nó nhắm `AUDIT_LOG_VIEW` = sai đối tượng). Người nhận phải khớp `approval-service.listCancelRequests`/`canApprove`: (a) yêu cầu MỚI → gửi cho đúng người được duyệt request đó (loại self, loại non-ELEVATED khi requester là Quản lý/Admin); (b) duyệt/từ chối → gửi cho `recipientId = request.requestedBy`. Gate: test người-nhận đúng cho 3 nhánh (NV tạo/Manager tạo/Admin tạo).
- `duplicate-notify`: 1 sự kiện đẩy 1 lần → gate: test idempotent.

**③ File được bảo vệ:** `preload/index.d.ts` (chỉ Edit). Sau sửa: `npm run audit:protected` PASS.

**④ Việc (ĐÚNG 1 gap — CẤM over-reach):** Trong `approval-service.ts`, tại `requestCancelBill` / `approveOne` (approveCancelBill(s)) / `rejectOne` (rejectCancelBill(s)) → **chèn tạo `messages` kind=SYSTEM** cho đúng người nhận (mục ②). Tái dùng badge + MessagesDrawer sẵn có. **CẤM dựng chuông/panel/badge mới** (UI đã có — vi phạm R_UI_STANDARD nếu trùng). Không mở rộng nguồn sự kiện khác (user khóa/backup/công nợ) ở frame này.

**⑤ Bằng chứng máy-kiểm (dán output thô; AUDIT rerun sạch):** `npm run typecheck`=0 · `npm run build`=0 · `npm test`≥198 · **selftest=18 (approval) rerun = fail 0** (regression vì chạm `approval-service`) · **selftest MỚI =19** (luồng notify: đúng người nhận 3 nhánh + idempotent) pass đủ/fail 0 · `npm run audit:protected` PASS · `git status` sạch sau verify. Báo cáo: file đổi + output thô + chỗ suy luận. KHÔNG commit.

---

## PROMPT G10 — Triển khai đa máy (Postgres LAN + .exe) — Q1–Q6 ĐÃ CHỐT (10/7); chờ F-NOTIF freeze

**① Vai + repo:** như trên. Điều kiện khởi động (đủ CẢ 3): **(a)** F1 `p1.2` + **F-NOTIF đã freeze+tag** (thứ tự pipeline); **(b)** Mr.Long đã chốt **Q1–Q6** (PHASE_G10_DEPLOYMENT_SPEC §2); **(c)** LEAD mở frame. Thiếu 1 → KHÔNG bắt đầu. Đọc trước: `docs/PHASE_G10_DEPLOYMENT_SPEC.md` toàn bộ.
- **Số selftest:** F-NOTIF đã chiếm =19 → selftest concurrency G10 = **=20** (không dùng lại 19).

**② Đo lường trước bug:**
- `emit-trap` (đã có outDir nhưng cảnh giác) → verify LUÔN `--noEmit`.
- `sqlite-pg-incompat`: migration SQLite không chạy trên Postgres (AUTOINCREMENT/DATETIME/boolean) → gate: `migrate deploy` lên Postgres rỗng 0 lỗi + rà từng file migration.
- `tz-regression-F1`: TIMESTAMPTZ + UTC+7 tái lỗi lệch ngày (B16) → gate: test lại ca giá-theo-kỳ trên Postgres.
- `concurrency-lost-update`: 2 client ghi/sửa song song mất cập nhật → gate: selftest concurrency (I-G2/I-G3).
- `secret-in-client`: chuỗi kết nối DB lộ trong .exe → gate: review cấu hình (Q3/Q4).

**③ File được bảo vệ:** `preload/index.d.ts` + toàn bộ `migrations/*` (chỉ thêm mới, KHÔNG sửa migration đã tag).

**④ Việc:** theo PHASE_G10_DEPLOYMENT_SPEC §7 tuần tự G10.1→G10.6, mỗi bước gate §5. KHÔNG build song song.

**⑤ Bằng chứng:** gate §5 G-G10.1..6, AUDIT rerun sạch trên Postgres. KHÔNG commit.

---

## PROMPT F3 — Backlog Nhóm 1 còn lại (ngày dd/mm/yyyy + thùng rác UI + màu button) — SKELETON

**① Vai + repo:** như trên. **⛔ KHÔNG bắt đầu khi Mr.Long/LEAD chưa chốt scope §E1–E4.** Đọc `SPEC_V2_GAP_AND_BACKLOG.md` §C/§D/§E1–E4 + `UI_DESIGN_SYSTEM.md`.
**② Đo bug:** `emit-trap` (verify `--noEmit`); `ui-inconsistency` (màu/định dạng lệch trang) → gate QA UI; `date-format-regression` (dd/mm/yyyy + tách cột ngày/giờ, util chung) → gate test util `fmtDate/fmtTime`.
**③ Bảo vệ:** `preload/index.d.ts`.
**④ Việc:** util ngày dd/mm/yyyy tách cột · trang Thùng rác + phục hồi + cảnh báo xóa có liên kết · quy ước màu button (Sửa=vàng/Xác nhận=xanh/Xóa=đỏ) + dialog lỗi to rõ.
**⑤ Bằng chứng:** verify đầy đủ + QA UI. (Spec chi tiết viết khi tới frame.)

---

## PROMPT F4 — Nền móng SPEC v2.0 (multi-branch, mã CT 6 số, master data kho) — SKELETON, ⛔ chờ Mr.Long duyệt scope

**① Vai + repo:** như trên. Đọc `SPEC_V2_GAP_AND_BACKLOG.md` §B + §E Nhóm 2. **KHÔNG bắt đầu nếu Mr.Long chưa duyệt scope.**
**② Đo bug:** `schema-migration-risk` (thêm companyId/branchId nullable nền) → gate migrate + regression toàn bộ; `row-level-permission-gap` → gate test scope theo branch.
**③ Bảo vệ:** `preload/index.d.ts` + migrations.
**④ Việc:** (chốt scope trước) thêm cột nền multi-branch + mã chứng từ 6 số + master data thiếu.
**⑤ Bằng chứng:** verify đầy đủ. Spec chi tiết viết khi tới frame.
