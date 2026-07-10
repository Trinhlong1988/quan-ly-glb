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

## PROMPT G11 — Cập nhật phần mềm tích hợp (electron-updater, push→xác nhận→tải→thoát→mở lại→báo kết quả) — SẴN sau QA phản biện

> Spec đầy đủ: `docs/PHASE_G11_AUTOUPDATE_SPEC.md`. Mở lại hoãn D01 (`DEFERRED_REGISTRY.md`).

**① Vai + repo:** Bạn = CMD_BUILD. Chỉ sửa ổ D `D:\TT HKD AI\tools\quan-ly-glb`. CẤM đụng bản C. CẤM git commit/tag/push. Bí/bất định → DỪNG hỏi, KHÔNG đoán. Đọc TRƯỚC toàn bộ: `docs/PHASE_G11_AUTOUPDATE_SPEC.md`, `docs/CMD_BUILD_DISPATCH_PROTOCOL.md`, `apps/desktop/electron-builder.yml`, `apps/desktop/src/main/db.ts` (mẫu IPC/service), `preload/index.d.ts`, cách toast/thông báo hiện có (`components/` + `Dashboard.tsx`).

**② Đo lường trước bug (gate phòng ngừa — bắt buộc thoả):**
- `offline-safe` (RỦI RO CAO NHẤT): server cập nhật tắt/không với tới → `checkForUpdates`/download ném lỗi phải bị **nuốt trong try/catch**, app **vẫn khởi động + đăng nhập + dùng bình thường**, KHÔNG popup đỏ, KHÔNG crash. Gate: selftest ca (c).
- `dev-guard`: `!app.isPackaged` → KHÔNG khởi động updater (tránh crash dev/selftest). Gate: selftest ca (a).
- `no-auto-without-consent`: `autoDownload=false` — chỉ tải khi user bấm "Cập nhật ngay". KHÔNG tự tải ngầm.
- `semver-compare`: dùng so sánh semver chuẩn (0.1.10 > 0.1.9), KHÔNG so chuỗi. Gate: selftest ca (b).
- `stuck-state`: sau lỗi phải bấm **Cập nhật lại** để thử lại được (không kẹt cờ "đang tải"). Gate: selftest ca (f).
- `emit-trap`: verify LUÔN `npm run typecheck` (--noEmit). CẤM `tsc -p` trần. Sau verify `git status` sạch (không phun .js/.d.ts vào src/).
- `type-mirror-drift`: thêm DTO/method vào `preload/index.d.ts` → web typecheck 0 + `audit:protected` PASS. CHỈ Edit chèn, KHÔNG Write đè.

**③ File được bảo vệ:** `preload/index.d.ts` (chỉ Edit chèn). `electron-builder.yml` (thêm block `publish`, KHÔNG đổi phần khác). Sau sửa `npm run audit:protected` PASS.

**④ Việc (ĐÚNG spec §1–§2 + §5 — CẤM over-reach):**
1. Thêm `electron-updater` dependency trực tiếp `apps/desktop`.
2. `electron-builder.yml`: thêm `publish: {provider: generic, url: http://192.168.1.6:8686/updates/, channel: latest}`. Giữ `nsis.perMachine:false`.
3. `apps/desktop/src/main/update-service.ts` (MỚI): theo spec §2 — autoDownload=false, autoInstallOnAppQuit=true, `app.isPackaged` guard, check lúc ready + mỗi 60', try/catch nuốt lỗi, IPC events + handlers (`update:check`/`update:start`/`update:installNow`), marker `userData/update-result.json` (ghi trước quitAndInstall; đọc+xoá lúc boot → success/failed).
4. Renderer: banner "có bản mới" + [Cập nhật ngay]/[Để sau], thanh tiến trình %, thông báo **thành công rõ version+ngày** (bước 6), banner **lỗi + lý do + [Cập nhật lại]** (bước 7). Dùng toast/design system sẵn có, KHÔNG dựng chuông mới. Hiện **version hiện tại** ở footer Dashboard (IPC `app:getVersion`).
5. `preload/index.d.ts`: chèn method + DTO (onUpdateAvailable/onDownloadProgress/onUpdateDownloaded/onUpdateError/onUpdateSuccess/onUpdateFailed, checkUpdate/startUpdate/installUpdateNow/getAppVersion).
   **CẤM:** dựng server cập nhật (việc LEAD); đổi cơ chế cài (giữ nsis); tự tải khi chưa bấm; mở rộng ngoài 5 bước.

**⑤ Bằng chứng (dán THÔ; AUDIT rerun sạch):** `npm run typecheck`=0 · `npm run build`=0 · `npm test`≥205 · **selftest=23** (6 ca a–f spec §5) pass đủ/fail 0 · `npm run audit:protected` PASS · `git status` sạch. Liệt kê file đổi + chỗ suy luận + cách kiểm tay E2E. KHÔNG commit.

---

## PROMPT F-STATBAR — Thanh bộ đếm trực quan đầu MỌI trang danh sách (Mr.Long 10/7) — SẴN, chạy SAU con-mắt-mật-khẩu

> Cơ sở: Explore map code thật 10/7. **CẤM over-reach**: KHÔNG dựng lại KpiCard ở Debt/Revenue (đã có), KHÔNG bịa trường active/inactive cho thực thể không có.
> **Chốt scope Mr.Long cần xác nhận trước khi bắn:** Customer KHÔNG có trường ACTIVE/INACTIVE (chỉ deletedAt) → hiển thị **Tổng + theo đại lý/nguồn**, KHÔNG bịa "hoạt động/không". POS/TID quy ước nhóm trạng thái = "hoạt động".

**① Vai + repo:** Bạn = CMD_BUILD. Chỉ sửa ổ D `D:\TT HKD AI\tools\quan-ly-glb`. CẤM đụng bản C. CẤM git commit/tag/push. Bí → DỪNG hỏi. Đọc trước: `docs/UI_DESIGN_SYSTEM.md`, `docs/CMD_BUILD_DISPATCH_PROTOCOL.md`, `components/StatusPill.tsx` (từ điển trạng thái chuẩn), `pages/Dashboard.tsx` (mẫu BreakdownCard/KpiCard ln462-497), `pages/DebtPage.tsx`+`RevenuePage.tsx` (mẫu KpiCard lặp — sẽ gộp).

**② Đo lường trước bug (gate):**
- `emit-trap`: verify LUÔN `npm run typecheck` (--noEmit), CẤM `tsc -p` trần, git status sạch.
- `type-mirror-drift`: nếu thêm DTO stats vào `preload/index.d.ts` → web typecheck 0 + `audit:protected` PASS. CHỈ Edit chèn.
- `ui-inconsistency`: 1 component `StatBar` DÙNG CHUNG mọi trang — cấm mỗi trang 1 kiểu (R_UI_STANDARD). Nhãn/màu trạng thái LẤY TỪ `StatusPill`/`statusLabel`, không hardcode lại.
- `count-pagination-drift`: nếu trang phân trang, đếm client-side từ `rows` sẽ SAI khi chỉ tải 1 trang → PHẢI đếm ở main (API count/summary), không đếm từ mảng đã phân trang. Trang chưa phân trang (tải full) mới được đếm client.
- `regression`: chạm nhiều page → typecheck/build/vitest phải xanh; selftest hiện có giữ nguyên số.

**③ File được bảo vệ:** `preload/index.d.ts` (chỉ Edit). Sau sửa `npm run audit:protected` PASS.

**④ Việc (ĐÚNG phạm vi Explore chốt):**
1. Tạo `components/StatBar.tsx` dùng chung: nhận `items: {label, value, tone?}[]`, render hàng thẻ đếm gọn trên đầu trang; tái dùng token màu design system + `statusLabel` cho nhãn trạng thái. Responsive, không phá layout.
2. **Gộp** KpiCard đang lặp ở `DebtPage.tsx`(ln19) + `RevenuePage.tsx`(ln45) về 1 nguồn (StatBar hoặc KpiCard chung) — hết copy-paste.
3. Gắn StatBar (chỉ số theo Explore) cho các trang CHƯA có:
   - **StaffPage**: Tổng nhân sự · Hoạt động(ACTIVE) · Đã khóa(LOCKED) · Chờ/Ngưng(PENDING+DISABLED).
   - **RolesPage**: Tổng vai trò · Hoạt động · Đã khóa (dùng `userCount` sẵn trong RoleDto).
   - **PosPage**: Tổng máy · theo status (IN_STOCK/DEPLOYED/IN_REPAIR/DAMAGED/RETIRED).
   - **TidPage**: Tổng TID · Chưa giao(sẵn có) · theo status · (nếu dễ) theo ngân hàng.
   - **ApprovalPage**: Tổng · Chờ duyệt(PENDING) · Đã duyệt · Từ chối.
   - **CustomersPage**: Tổng khách · theo đại lý/nguồn (KHÔNG bịa active/inactive).
   - **TrashPage**: Tổng mục · theo `kind`.
4. API đếm ở main khi cần chính xác (trang có filter/nhiều bản ghi): thêm method `*Stats`/`*Summary` (mẫu `dashboard-service.ts` đã có `posByStatus`/`tidsByBank` — tách thành API trang dùng được). User theo status / Role theo status / POS theo status / TID theo status / CancelRequest theo status / Customer theo agent / Trash theo kind. Trang nào tải full rows không phân trang thì được phép đếm client (ghi rõ trang nào đếm ở đâu).

**⑤ Bằng chứng (dán THÔ; AUDIT rerun sạch):** `npm run typecheck`=0 · `npm run build`=0 · `npm test`≥205 (thêm test đếm nếu có API mới) · `npm run audit:protected` PASS · `git status` sạch. Liệt kê từng trang + chỉ số đã gắn + đếm ở client hay main. KHÔNG commit.

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
