# BUGS_FIXED — Quản Lý GLB

> Rule: mỗi bug do LEAD/AUDIT phát hiện = **thất bại của quy trình test** → BẮT BUỘC thêm test/rule chặn tái diễn trước khi đóng.
> Format: `### B<NN> — <mô tả> [FIXED|PENDING]` · Phát hiện bởi · Nguyên nhân · Fix · **Regression** (test/rule chặn tái diễn).

Counter: B = 16. Last audit: 2026-07-10 (Nhóm B doanh thu + Nhóm E bảo trì + 3 agent phản biện song song; P1.1 giá theo kỳ + F1 lệch ngày UTC+7).

### B16 — Ngày hiệu lực biểu phí LỆCH −1 NGÀY trên máy UTC+7 (production) [FIXED]
- **Phát hiện bởi:** CMD_AUDIT (audit P1.1 giá theo kỳ) — máy production chạy UTC+7. User nhập "Hiệu lực từ = 01/07/2026" nhưng bảng biểu phí hiển thị/lưu **30/06/2026**.
- **Nguyên nhân:** `setFeeRate` floor `effectiveFrom` theo **UTC-day** (`startOfDayUtc` = `Date.UTC(getUTCFullYear/Month/Date)`), trong khi CẢ app còn lại (`txnDate`, filter `dateFrom/dateTo`) lưu **nguyên instant nửa-đêm-LOCAL** do UI dựng `new Date(d+'T00:00:00').toISOString()` (không `Z`), và `fmtDate` round-trip bằng **getter LOCAL**. Bất đối xứng đúng bằng offset +7h: UI gửi 01/07 local (= `2026-06-30T17:00Z`) → `startOfDayUtc` floor theo UTC-day về `2026-06-30T00:00Z` → `fmtDate` (local) hiện 30/06. Tiền doanh thu vẫn ĐÚNG (2 vế `pickEffectiveRate`/txnDate cùng so instant), nhưng NGÀY sai → vi phạm R_DATE_FORMAT (LEAD lock 9/7).
- **Fix:** thay `startOfDayUtc` bằng `startOfDayLocal(d)` = `new Date(d.getFullYear(), d.getMonth(), d.getDate())` — chuẩn hóa về nửa-đêm-LOCAL, đối xứng với `fmtDate` và `txnDate`. Sau sửa: nhập 01/07 → lưu instant nửa-đêm 01/07 local → `fmtDate` hiện "01/07/2026"; GD ngày 01/07 ăn đúng kỳ, GD ngày 30/06 KHÔNG ăn kỳ 01/07. KHÔNG đụng `pickEffectiveRate` (thuần, đã đúng), dedup 24h, `isCurrent`, snapshot, schema/migration.
- **Regression (chặn tái diễn):** REV15 khối mới **L) GIÁ THEO KỲ — ĐƯỜNG UI** (parse-LOCAL, KHÔNG `Z`, tổ hợp/tid riêng): set kỳ `effectiveFrom = new Date('2026-08-01T00:00:00').toISOString()` (như UI gửi) → `listFeeRates` → assert **`fmtDate(dto.effectiveFrom) === '01/08/2026'`** (chứng cứ chạy thật: `iso=2026-07-31T17:00:00.000Z` = nửa-đêm 01/08 trên UTC+7, hiển thị đúng 01/08). Kèm: GD `txnDate` local 2026-08-01 ăn kỳ 01/08 (margin 4000/3000); GD local 2026-07-31 KHÔNG ăn, rơi về kỳ 01/07 (margin 2000/1500). REV15 pass=73 fail=0.
- **Đề xuất quy trình (bug class = "ngày lệch do trộn UTC-day / LOCAL-day"):** mọi test liên quan **hiển thị/so sánh NGÀY** PHẢI có ≥1 ca đi qua **đường parse-LOCAL** (ISO KHÔNG `Z`, đúng như UI gửi), KHÔNG chỉ ISO `Z` (UTC thuần). Điểm mù cũ: toàn bộ selftest + unit dùng ISO có `Z` nên không đi qua đường UI parse-local → bug lọt trên máy UTC+7. Mọi chuẩn-hóa "về đầu ngày" phải đối xứng với hàm hiển thị (`fmtDate` dùng getter LOCAL ⇒ floor phải LOCAL).

### B10 — `updateTransaction` tra lại phí "giá hôm nay" khi chỉ sửa note/ngày/số tiền → PHÁ snapshot doanh thu đã khóa [FIXED]
- **Phát hiện bởi:** CMD_AUDIT (agent phản biện doanh thu #1) — sửa ghi chú 1 giao dịch cũ khiến doanh thu bị tính lại theo biểu phí HIỆN TẠI, làm sai sổ đã chốt.
- **Nguyên nhân:** `updateTransaction` luôn `resolveFeeForTxn` rồi ghi đè `partnerMarginMilli/sellMarginMilli` bất kể trường nào đổi. Vi phạm nguyên tắc snapshot (phí phải đóng băng vào từng GD; đổi bảng phí sau này KHÔNG được đổi doanh thu đã ghi).
- **Fix:** chỉ tra lại phí khi `cardTypeId` thực sự đổi (`cardChanged`); mọi trường khác giữ nguyên margin snapshot của bản ghi. `computeRevenue` chạy lại từ margin đã khóa.
- **Regression (chặn tái diễn):** REV15 thêm 2 assert — (a) sửa note/ngày → `revenuePartner/Sell/Amount` KHÔNG đổi; (b) đổi bảng phí rồi sửa note → doanh thu vẫn bằng snapshot cũ. **Đề xuất quy trình:** mọi service ghi số tiền dẫn xuất phải có test "sửa trường không-liên-quan → số tiền bất biến".

### B11 — Lọc doanh thu theo TID dùng `deletedAt:null` → giao dịch của TID đã xóa mềm biến mất khỏi báo cáo [FIXED]
- **Phát hiện bởi:** CMD_AUDIT (agent phản biện doanh thu #2) — TID bị xóa mềm thì toàn bộ doanh thu lịch sử của nó rơi khỏi tổng hợp → sai doanh thu/công nợ.
- **Nguyên nhân:** `buildWhere` resolve TID theo tid-string kèm điều kiện `deletedAt: null`; TID xóa mềm không match → where TID rỗng → loại hết GD của TID đó.
- **Fix:** bỏ `deletedAt:null` khỏi `tidWhere` (GD gắn `tidId` cứng, không phụ thuộc trạng thái sống/chết của TID). Báo cáo phản ánh đủ doanh thu lịch sử.
- **Regression (chặn tái diễn):** REV15 thêm assert — xóa mềm 1 TID rồi lọc theo tid-string đó vẫn trả đúng GD + summary. **Bài học:** báo cáo tài chính lấy theo khóa bất biến (`tidId`), không theo trạng thái hiện tại của thực thể tham chiếu.

### B12 — Cấu hình lưu trữ cho phép hạn giữ dưới sàn an toàn → dọn dẹp có thể xóa dữ liệu quá sớm [FIXED]
- **Phát hiện bởi:** CMD_AUDIT (agent phản biện storage) — cấu hình `auditRetentionDays=0`/`trashRetentionDays=0` khiến purge có thể xóa audit/thùng rác ngay lập tức, mất dấu vết.
- **Nguyên nhân:** `runCleanup` dùng thẳng giá trị cấu hình làm mốc cắt, không có sàn tối thiểu; `updateStorageConfig` không validate cận dưới.
- **Fix:** hằng sàn `MIN_AUDIT_DAYS=7`, `MIN_TRASH_DAYS=1`, `MIN_BACKUP_HOURS=1`; helper `auditRetention/trashRetention/backupInterval` = `Math.max(config, floor)` ở MỌI điểm tính mốc cắt; `updateStorageConfig` reject giá trị dưới sàn (VALIDATION).
- **Regression (chặn tái diễn):** STG16 thêm assert — set retention=0 bị reject; purge với cấu hình hợp lệ vẫn tôn trọng sàn (không xóa bản ghi mới hơn sàn). **Đề xuất quy trình:** mọi tham số điều khiển thao tác phá hủy phải có sàn an toàn code-enforced, không tin cấu hình.

### B13 — Health-Scan tự sửa doanh thu KHÔNG backup trước → mất bản gốc nếu công thức sai [FIXED]
- **Phát hiện bởi:** CMD_AUDIT (agent phản biện health-scan) — autoFix ghi đè `revenue*` mà chưa có bản sao lưu → nếu logic recompute sai thì không hoàn tác được.
- **Nguyên nhân:** `runScan({autoFix:true})` gọi `applyAutoFixes` trực tiếp, không backup trước.
- **Fix:** `runScan` gọi `systemBackup` TRƯỚC `applyAutoFixes`; backup lỗi → ABORT, không tự sửa (an toàn dữ liệu ưu tiên tuyệt đối).
- **Regression (chặn tái diễn):** HSC17 assert — sau autoFix, `backup_logs` +1 (backup xảy ra TRƯỚC khi ghi đè). **Bài học:** mọi thao tác tự-sửa hàng loạt phải backup-trước-abort-nếu-lỗi.

### B14 — Trash: xóa vĩnh viễn/dọn sạch bị TỪ CHỐI (sai mật khẩu, chưa đặt cấp 2) KHÔNG ghi audit → mất dấu vết ý đồ phá hoại [FIXED]
- **Phát hiện bởi:** CMD_AUDIT (agent phản biện bảo mật) — thao tác phá hủy bị chặn nhưng im lặng, vi phạm R_AUDIT_003 (thao tác phá hủy phải ghi audit KỂ CẢ khi bị từ chối).
- **Nguyên nhân:** `purgeItem`/`emptyTrash` return sớm ở nhánh sai mật khẩu / `LEVEL2_NOT_SET` / `WRONG_LEVEL2` mà không `writeAudit`.
- **Fix:** thêm `writeAudit(..., after:{denied:true, reason})` ở cả 3 nhánh từ chối (WRONG_PASSWORD / LEVEL2_NOT_SET / WRONG_LEVEL2).
- **Regression (chặn tái diễn):** TRASH6 (selftest =6) thêm khối FIX5 — mỗi nhánh từ chối làm `audit_logs` +1 (afterJson chứa reason), bản ghi VẪN còn (không xóa cứng), thùng rác KHÔNG bị xóa. **Đây là ca selftest cũ bỏ sót** (chỉ test đường thành công). **Đề xuất quy trình:** mọi handler thao tác phá hủy phải có test "đường từ chối cũng ghi audit".

### B15 — Trang Công nợ giới hạn 500 bản ghi âm thầm (không phân trang) → tổng hợp thiếu khi >500 GD chưa thu [FIXED]
- **Phát hiện bởi:** CMD_AUDIT (agent phản biện doanh thu #3) — DebtPage tải tối đa 500 dòng, không phân trang, tổng ở tfoot chỉ cộng trang đang thấy → sai công nợ khi vượt ngưỡng.
- **Nguyên nhân:** DebtPage thiếu state phân trang; summary tính từ danh sách bị cắt.
- **Fix:** thêm `page/total/pageSize` + `reload(pg)` phân trang; summary công nợ lấy từ aggregate TOÀN BỘ tập lọc (service-side), không từ trang hiển thị.
- **Regression (chặn tái diễn):** REV15/debtSummary assert summary cộng trên toàn tập lọc, độc lập phân trang. **Bài học:** mọi tổng hợp phải tính server-side trên full filtered set, không phải trên trang UI (cùng lớp với "silent cap" — luôn `log`/hiển thị khi cắt).

### B08 — DTO giao dịch select `customer.name` (không tồn tại) → PrismaClientValidationError khi liệt kê doanh thu [FIXED]
- **Phát hiện bởi:** CMD_BUILD khi tự chạy selftest =15 (REV15) — dừng ngay sau khi tạo GD2, `listTransactions` ném `PrismaClientValidationError` (không in ra được danh sách). Bắt TRƯỚC khi báo cáo (đúng R9 evidence-first).
- **Nguyên nhân:** `transaction-service.listTransactions` resolve tên khách bằng `db.customer.findMany({ select: { id, name } })` — model `Customer` KHÔNG có cột `name` (chỉ `fullName` + `nickname` + `code`). Prisma validate select ở tầng client → ném lỗi runtime.
- **Fix:** đổi sang `select: { id, fullName }` và map `customerName = fullName`. Selftest REV15 xác nhận DTO trả `customerName = "Khách Doanh Thu"` đúng.
- **Regression (chặn tái diễn):** [ĐÃ có] REV15 assert DTO có nhãn khách/loại thẻ/HKD/MID → bắt đúng lớp bug này. **Đề xuất quy trình:** esbuild của electron-vite KHÔNG typecheck đầy đủ → sai tên cột Prisma `select` lọt build. BẮT BUỘC chạy `npm run typecheck` (tsc `-p tsconfig.node.json`) TRƯỚC khi coi backend "build OK" — Prisma client typed sẽ bắt `select` sai tên cột ở compile-time. CMD_AUDIT thêm bước: chạy typecheck node+web = 0 lỗi là gate bắt buộc.

### B09 — Selftest treo/ báo "table does not exist" do (a) process schema-engine/electron kẹt + (b) path MSYS `/c/` vs Windows `C:/` lệch [FIXED — test infra]
- **Phát hiện bởi:** CMD_BUILD khi chạy selftest =17 — `prisma migrate deploy` timeout 60-120s; electron báo `table main.permissions does not exist` dù DB vừa deploy xong.
- **Nguyên nhân kép:** (1) Các lần selftest bị timeout để lại process `schema-engine-windows.exe` + `electron.exe` treo, GIỮ LOCK trên DB/migrations → mọi `migrate deploy` sau đó bị chặn (SocketTimeout). (2) `migrate deploy` dùng `DATABASE_URL='file:/c/Users/ADMINI~1/...'` (path MSYS) còn electron dùng `GLB_DB_URL='file:C:/Users/Administrator/...'` (path Windows) → Prisma tạo bảng ở MỘT file, electron mở file KHÁC (rỗng) → "table does not exist". Trước đây trùng path MSYS nên vô tình khớp.
- **Fix:** (a) trước mỗi đợt selftest `taskkill /F /IM electron.exe` + `taskkill /F /IM schema-engine-windows.exe`; (b) DÙNG CÙNG dạng path Windows `C:/...` cho CẢ `migrate deploy` LẪN `GLB_DB_URL`, hoặc copy sẵn `dev.db` (đã checkpoint WAL) sang file tạm rồi trỏ GLB_DB_URL path Windows. Sau fix: REV15 43/0, STG16 33/0, HSC17 22/0, fresh-deploy 16/0.
- **Regression (chặn tái diễn):** **Quy trình chuẩn chạy selftest (bổ sung B04):** 1) kill electron + schema-engine trước; 2) path Windows `C:/...` đồng nhất giữa migrate & GLB_DB_URL (hoặc copy dev.db đã checkpoint); 3) `dev.db` phải `PRAGMA wal_checkpoint(TRUNCATE)` trước khi copy (WAL split làm copy thiếu bảng). **Bài học:** treo test = thất bại hạ tầng test, không phải lỗi sản phẩm — nhưng phải dọn process + đồng nhất path để kết quả lặp lại được.

### B07 — Thứ tự migration sai: folder timestamp TRƯỚC bảng phụ thuộc → fresh deploy fail [FIXED]
- **Phát hiện bởi:** CMD_AUDIT (selftest =13 fresh-deploy) — chạy trên DB throwaway MỚI báo PrismaClientKnownRequestError; chỉ 2 assert đầu pass rồi crash.
- **Nguyên nhân:** migration `deletedBy` được `prisma migrate dev --create-only` sinh timestamp `20260709165229`, NHỎ HƠN gcfg4/5/6 (`170000/180000/190000`). Trên dev.db (đã áp mọi migration) thì deploy chỉ thêm migration cuối → OK. Nhưng trên DB MỚI, deploy áp theo THỨ TỰ tên folder → `deletedBy` (165229) chạy TRƯỚC khi gcfg4/5/6 tạo bảng `dossiers`/`receive_accounts`/`tid_config_statuses` → `ALTER TABLE ... ADD COLUMN deleted_by` trên bảng CHƯA tồn tại → fail. Cùng lớp với B02 (migration history drift).
- **Fix:** đổi tên folder → `20260709200000_nhoma_deletedby_per_user_trash` (sau MỌI migration). Dựng lại dev.db fresh để history khớp.
- **Regression (chặn tái diễn):** [ĐÃ có] selftest fresh-deploy (migrate deploy sang DB throwaway TRỐNG) bắt đúng lớp bug này — mọi selftest N≥2 đều chạy fresh deploy. **Đề xuất quy trình:** sau mỗi `migrate dev --create-only`, PHẢI kiểm tra timestamp folder > mọi migration nó phụ thuộc (bảng bị ALTER phải được tạo ở migration có timestamp NHỎ HƠN). Nếu migration đụng bảng của feature mới hơn → rename folder cho đúng thứ tự.

### B06 — Seed KHÔNG cấp quyền MỚI cho role đã tồn tại → ADMIN thiếu quyền → menu bị ẩn [FIXED]
- **Phát hiện bởi:** LEAD (Mr.Long) khi mở app thấy toàn bộ menu Cấu hình biến mất dù code đủ.
- **Nguyên nhân:** `db.ts seedIfEmpty` upsert permission mới vào bảng `permissions` NHƯNG chỉ gán `role_permissions` cho role VỪA TẠO (fix G-POS-A01 giữ chỉnh tay admin). Role ADMIN có từ Phase A không nhận quyền CONFIG_* mới → kẹt 29/43 → `hasAnyPermission` ẩn menu.
- **Vì sao test không bắt:** MỌI selftest chạy DB throwaway MỚI → role tạo mới → quyền tự seed → ADMIN đủ → PASS. Chưa mô phỏng ca thật "DB đã tồn tại + thêm feature thêm permission" (đường nâng cấp/production). Đúng R196 Engineering PASS ≠ Production PASS.
- **Fix:** thêm khối `R_ADMIN_SUPERUSER` trong seedIfEmpty — ADMIN = superuser, LUÔN đồng bộ ĐỦ mọi permission mỗi boot (role khác giữ chỉnh tay). Bằng chứng nâng cấp thật: adminroot trên dev.db CŨ tự lên 43→48 quyền sau khi thêm 5 permission Nhóm A.
- **Regression (chặn tái diễn):** [ĐÃ có 1 phần] mọi permission mới sẽ tự tới ADMIN. **CÒN NỢ (đề xuất quy trình):** thêm test class "DB tiến hóa/upgrade" — seed DB cũ (thiếu permission X) → thêm X → gọi seedIfEmpty → assert ADMIN nhận đủ X. Ca này bắt đúng bug; selftest hiện chỉ chạy DB fresh nên chưa cover. Ghi nợ để slice sau bổ sung.

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


### REV-B01 — Sửa giao dịch phá snapshot phí (tái định giá theo biểu phí hiện tại) [ĐÃ CHỐT HƯỚNG FIX — Phase 1]
- **Phát hiện bởi:** CMD_AUDIT (audit Nhóm B, đọc `transaction-service.ts:244-262`). Selftest 43/43 KHÔNG bắt được (điểm mù: selftest khôi phục biểu phí về chuẩn TRƯỚC khi update → recompute trùng snapshot).
- **Nguyên nhân:** `updateTransaction` luôn gọi lại `resolveFeeForTxn` đọc biểu phí HIỆN TẠI rồi ghi đè margin/doanh thu — bất kể sửa trường gì. Sửa ghi chú của GD cũ cũng tái định giá theo phí mới → phá bất biến snapshot LEAD chốt; GD đã đối soát cũng bị đổi số đã ghi.
- **Hướng fix (LEAD 9/7 chốt qua thiết kế Phase 1):** chứng từ bill **BẤT BIẾN** — bỏ hẳn sửa bill; sai thì **hủy có lý do + duyệt Manager/Admin + tạo bill mới**. Doanh thu dẫn xuất tính theo **kỳ giá tại txnDate** (không phải giá hôm nay). Đóng triệt để.
- **Regression:** bất biến I4 (sửa note không đổi tiền — nay là "không có đường sửa bill" I17), I19 (backfill không đổi số gốc). PHẢI có ca "đổi giá kỳ RỒI thao tác" để khỏi mù như selftest cũ.

### REV-B02 — Lọc bill theo TID/đối tác/MID/HKD bỏ sót giao dịch của TID đã xóa mềm [ĐÃ CHỐT HƯỚNG FIX — Phase 1]
- **Phát hiện bởi:** CMD_AUDIT (`transaction-service.ts:324` — `buildWhere` resolve tidId chỉ lấy TID `deletedAt:null`).
- **Nguyên nhân:** GD tồn tại độc lập (khóa `tidId`), nhưng lọc lại chỉ tra TID còn sống → xóa mềm cấu hình TID làm doanh thu/công nợ của TID đó biến mất khi lọc. Vi phạm nguyên tắc "bill bất biến, độc lập vòng đời TID/serial".
- **Hướng fix:** lọc bill theo `tidId` **bất kể** TID còn sống hay đã xóa mềm. Bất biến I11.

### REV-B03 — Trang Công nợ cap 500 dòng nhưng KPI/tfoot tính tổng toàn bộ, không phân trang [ĐÃ CHỐT HƯỚNG FIX — Phase 1]
- **Phát hiện bởi:** CMD_AUDIT (`DebtPage.tsx:76,182-190` + clamp `listTransactions:387`).
- **Nguyên nhân:** bảng nạp `pageSize:500` (bị clamp), footer/KPI dùng aggregate toàn bộ → >500 GD chưa đối soát thì tổng không khớp dòng hiển thị và không có cách xem/đối soát phần vượt.
- **Hướng fix:** thêm phân trang trang Công nợ + thống kê đã/chưa thu 2 chiều (Phase 1, mục công nợ).
