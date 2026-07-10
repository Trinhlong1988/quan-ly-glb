---
project: Quản Lý GLB (IMS)
phase: G-REV.B / G-MAINT.E
current_version: 0.20.0-h2-debt
status: H2-debt (Thu công nợ net-of-settlement + vô hiệu toggle settled) ENGINEERING VALIDATED — chờ LEAD AUDIT + commit + tag. (H1 cashcat committed 9ead981; H2-core 1b333e4.)
last_update_ts: 2026-07-10
last_update_by: CMD_BUILD (Executor) — chờ LEAD rerun độc lập
rule_break_count: 0
schema_version: 16
repo_path: D:\TT HKD AI\tools\quan-ly-glb (chuyển C→D 10/7; bản C giữ làm sao lưu, cấm sửa)
---

# VERSION — Quản Lý GLB

## Session start protocol
1. Đọc `CLAUDE.md` → `docs/IMS_SPEC_v1_0.md`.
2. Đọc file này, so `last_known_version`; mismatch → re-read artifact đổi.
3. Đọc `BUGS_FIXED.md` trước khi chạm code.
4. Đọc `bible/00_constitution.md`.

## Nhật ký phiên bản
### 0.20.0-h2-debt — 2026-07-10 (PHASE H2-debt Thu–Chi) — THU CÔNG NỢ NET-OF-SETTLEMENT + VÔ HIỆU TOGGLE SETTLED · chờ LEAD AUDIT
- **Phạm vi (đúng H2-debt):** 1 model mới `CashDebtSettlement` (cashEntryId, transactionId, side PARTNER|SELL, amount, createdAt Timestamptz+map, @@index cashEntryId+transactionId). Migration `20260710240000_cash_debt_settlement` (schema v16). AuditAction thêm `CASH_DEBT_RECEIPT_CREATED`.
- **`createDebtReceipt` (cash-entry-service.ts):** 1 phiếu THU (category DEBT_CUSTOMER|DEBT_PARTNER) tất toán ≥1 GD qua lines `[{transactionId, side, amount}]` trong 1 `$transaction`: mỗi (GD,side) kiểm `amount ≤ revenue(side) − Σ settle(side)` (NET, I#2) → vượt = `DEBT_OVERPAY` (rollback); GD tồn tại/chưa xóa/status≠CANCELLED/khớp customerId|partnerId (partner qua TID); tạo CashEntry (sourceType=null) + N settlement; **HỆ QUẢ** GD nào cả 2 side net=0 → `settled=true` (không toggle tay). Guard `CASHENTRY_CREATE` + audit `CASH_DEBT_RECEIPT_CREATED` + PERMISSION_DENIED nhánh từ chối. Danh mục non-DEBT → VALIDATION.
- **Hủy phiếu thu công nợ (M3):** mở rộng `cancelCashEntry` — trong cùng `$transaction` sau khi POSTED→CANCELLED, xóa (hard) các `CashDebtSettlement` của phiếu + tính lại `settled` các GD liên quan (net>0 → settled=false). Nguyên tử, chống hủy 2 lần (updateMany count===0 chặn trước khi gỡ settlement).
- **debtSummary viết lại NET (I#2, transaction-service.ts):** KHÔNG dùng `where.settled=false`; với tập GD (chưa xóa, status≠CANCELLED) `debt(side) = Σ max(0, revenue(side) − Σ settle(side))`, chỉ tính phần>0, count = số GD net>0. Group-by settlement theo (transactionId,side) — không N+1. Thêm `debtOpenTransactions(filter)` trả per-GD remaining per side cho DebtPage + màn Thu công nợ.
- **H5 vô hiệu toggle settled thủ công:** `settleTransactions` trả `DEBT_SETTLE_DISABLED` (giữ chữ ký, không xóa import cũ); GỠ IPC handler `transaction:settle`; gỡ nút "Đánh dấu đã thu" + selection trên DebtPage. `settled` chỉ đổi qua createDebtReceipt/hủy phiếu.
- **IPC/preload:** thêm `cashEntry:createDebtReceipt` + `debt:openTransactions`; gỡ handler `transaction:settle`. preload/index.ts +2 bridge (`cashEntryCreateDebtReceipt`, `debtOpenTransactions`); index.d.ts CHỈ THÊM (`DebtReceiptLine`/`CreateDebtReceiptInput`/`DebtOpenTxnDto`/`DebtOpenResult` + 2 method) → 1445 dòng, đủ 5 anchor.
- **Renderer DebtPage:** bảng chuyển sang `debtOpenTransactions` (hiện nợ CÒN LẠI net từng side) + nút "Thu" từng dòng mở `DebtReceiptModal` (nhập số thu PARTNER/SELL ≤ còn lại, chọn quỹ/hình thức/ngày/ghi chú → createDebtReceipt); DEBT_OVERPAY → toast.alert. Gỡ toggle settle thủ công. StatBar giữ chuẩn (net).
- **Gate (báo số thật, chờ LEAD rerun độc lập):** typecheck0 · build0 · vitest **205/205** · audit:protected PASS (preload 1445 dòng, 5 anchor) · audit:deferred OK · **selftest=27 32/0** (I#2 net thu từng phần + DEBT_OVERPAY rollback + settled hệ quả + I#1 quỹ đúng + I#13 lợi nhuận Δ=0 + M3 hủy hoàn settlement/quỹ + create thường chặn DEBT_* + SALES FORBIDDEN+audit + H5 DEBT_SETTLE_DISABLED) · regression **selftest=26 46/0** + **selftest=25 47/0** + **selftest=2 failures=0** (Postgres throwaway riêng từng test).
- Status: **H2-debt L1 Engineering Validated — chờ LEAD AUDIT + commit + tag.** Kế: H2b (công nợ chất lượng debtQuality) / H3 (tạm ứng).

### 0.19.0-h2-core — 2026-07-10 (PHASE H2-core Thu–Chi) — QUỸ + PHIẾU THU/CHI + LỢI NHUẬN MVP · chờ LEAD AUDIT
- **Phạm vi (đúng H2-core, KHÔNG lấn H2-debt):** 2 model mới `Fund` (code QU + type CASH/BANK/EWALLET + keeper + opening_balance + soft-delete) + `CashEntry` (code PT/PC + kind THU/CHI + categoryId + fundId + amount>0 + method + entry_date + đối tượng + status POSTED/CANCELLED + đủ @@index), mọi DateTime `@db.Timestamptz(3)` + `@map`. Migration `20260710230000_cash_entry_fund` (schema v15). **KHÔNG** tạo `CashDebtSettlement` (H2-debt).
- **Services:** `fund-service.ts` (CRUD + số dư running I#1 = opening + Σ THU_POSTED − Σ CHI_POSTED, KHÔNG lưu cứng R6; xóa mềm chặn IN_USE nếu có phiếu; mã QU trong $transaction; verifyActorPassword) · `cash-entry-service.ts` (lập phiếu POSTED thẳng + list/summary + `cashflowReport` lọc ngày+danh mục+quỹ; hủy POSTED→CANCELLED nguyên tử conditional updateMany + verifyActorPassword + lý do; category cùng kind + active; CHẶN công nợ `DEBT_RECEIPT_DEFERRED`; CHI bắt buộc payerUserId `PAYER_REQUIRED`; amount>0 nguyên không tràn; ngày local B16; mã PT/PC trong $transaction) · `dashboard-service.getMonthlyProfit` (accrual §5: Σ Transaction.revenueAmount + Σ CashEntry THU affectsPnl − Σ CashEntry CHI affectsPnl, tháng này + tháng trước, KHÔNG double-count I#13).
- **Quyền:** `FUND_VIEW/CREATE/UPDATE/DELETE` + `CASHENTRY_VIEW/CREATE/CANCEL` (group "Thu – Chi"), default cho MANAGER + ACCOUNTANT (ADMIN qua superuser-sync) + migration idempotent `grantCashflowPermsToExistingRoles` (cờ AppSetting `seed.cashflowPermsGrantedV1`, target MANAGER+ACCOUNTANT). Bug class "DB tiến hóa" (H7).
- **IPC/preload:** `fund:*` + `cashEntry:*` + `dashboard:profit` + preload (index.ts + index.d.ts CHỈ THÊM, giữ 5 anchor, 1401 dòng). Lite endpoints `fund:userLite` + `cashEntry:categoryLite` (không cần CASHCAT_VIEW).
- **Renderer:** trang `FundPage` (quỹ + số dư running + StatBar) · `CashEntryPage` (1 component, prop kind → Phiếu thu / Phiếu chi; phiếu chi bắt buộc người chi; hủy phiếu xác nhận mật khẩu+lý do) · `CashflowReportPage` (FilterBar ngày + danh mục/quỹ + tổng THU/CHI/chênh) · KpiCard Lợi nhuận accrual + so tháng trước trên Dashboard. Menu: nhóm "Thu – Chi" (Quỹ · Phiếu thu · Phiếu chi · Báo cáo thu – chi) cạnh Cấu hình thu – chi, ẩn theo quyền.
- **Gate (báo số thật, chờ LEAD rerun độc lập):** typecheck0 · build0 · vitest **205/205** · audit:protected PASS (preload 1401 dòng, 5 anchor) · audit:deferred OK · **selftest=26 46/0** (I#1 quỹ cân + hủy · I#3 · I#4 · I#10 · category sai kind/công nợ · I#13 lợi nhuận không double-count · mã QU/PT/PC · IN_USE · hủy sai/đúng mk · SALES FORBIDDEN+audit · DB tiến hóa 14 quyền idempotent) · regression **selftest=25 47/0** + **selftest=2 failures=0** (Postgres throwaway riêng từng test).
- **Bài học test:** `*/` (sequence đóng comment) NẰM trong `/** */` JSDoc khi viết `FUND_*/CASHENTRY_*` → phá parser TS (comment kết thúc sớm). → Trong JSDoc, tách `*` và `/` (dùng `FUND_* / CASHENTRY_*`) hoặc dùng `//` line-comment. Đề xuất quy trình: gate typecheck đã bắt ngay (không lọt) — giữ typecheck TRƯỚC build.
- Status: **H2-core L1 Engineering Validated — chờ LEAD AUDIT + commit + tag.** Kế: H2b (công nợ chất lượng) / H2-debt (thu công nợ + CashDebtSettlement net-of-settlement).

### 0.18.0-h1-cashcat — 2026-07-10 (PHASE H1 Thu–Chi) — DANH MỤC THU/CHI (CashCategory) · chờ LEAD AUDIT
- **Phạm vi (đúng H1, KHÔNG lố H2+):** model `CashCategory` (kind THU/CHI + unit + periodType + sourceKind + `affects_pnl` + isSystem + soft-delete, mọi DateTime `@db.Timestamptz(3)` + `@map`), migration `20260710220000_cash_category`, `cash-category-service.ts` (CRUD + guard/audit + bất biến affectsPnl I#12 + isSystem lock), seed 15 danh mục hệ thống idempotent, quyền `CASHCAT_VIEW/CREATE/UPDATE/DELETE` (group "Thu – Chi") + migration idempotent `grantCashCatPermsToExistingRoles` (cờ AppSetting `seed.cashCatPermsGrantedV1`, target MANAGER; ADMIN qua superuser-sync), IPC `cashCategory:*` + preload (+DTO), trang `CashCategoryConfigPage` + menu `cashcatcfg`, selftest `GLB_SELFTEST=25`.
- **Bất biến affectsPnl (I#12):** sourceKind nội bộ {DEBT_CUSTOMER,DEBT_PARTNER,DEPOSIT,DEPOSIT_REFUND,ADVANCE,DEVICE_DEPOSIT,FUND_TRANSFER} CẤM affectsPnl=true — chặn ở create+update → `PNL_FLAG_FORBIDDEN`. Tiền = VND nguyên (KHÔNG ×1000).
- **Gate (báo số thật, chờ LEAD rerun độc lập):** typecheck0 · build0 · vitest **205/205** · audit:protected PASS (preload 1267 dòng, 5 anchor) · audit:deferred OK · **selftest=25 47/0** (Postgres throwaway) · regression **selftest=2 failures=0**.
- **Bài học test:** username selftest phải ≥8 ký tự (validation) — bug scaffolding bắt được ngay ở gate selftest (không lọt). Selftest chạy bundled `out/` → PHẢI `npm run build` trước mỗi lần chạy selftest.
- Status: **H1 L1 Engineering Validated — chờ LEAD AUDIT + commit + tag.** Kế: H2 (CashEntry + Fund + phiếu thu/chi).

### 0.17.0-f-notif — 2026-07-10 (Frame F-NOTIF) — ĐẨY THÔNG BÁO HỦY BILL VÀO HÒM THƯ · FROZEN provisional
- **Phạm vi (đã QA phản biện thu hẹp):** chỉ nối `approval-service` → tạo `messages` kind=SYSTEM khi tạo/duyệt/từ chối yêu cầu hủy bill. **KHÔNG dựng lại chuông/badge/panel** (đã có sẵn `Dashboard` + `MessagesDrawer`). KHÔNG đụng `notification-service.ts` (stub Zalo).
- **Người nhận đúng vai:** yêu cầu MỚI → người được duyệt (khớp `canApprove`, loại người tạo, loại non-ELEVATED khi requester Manager/Admin); duyệt/từ chối → `requestedBy`. Idempotent (duyệt/từ chối lại → INVALID_STATE, không nhân đôi).
- **Gate (CMD_AUDIT verify độc lập):** typecheck0 · build0 · vitest198 · **selftest=18 rerun 31/0** · **selftest=19 (notify) 26/0** (đo delta/sự kiện) · guard PASS · 0 rác emit.
- **Bài học test (ghi):** đếm thông báo đa-sự-kiện phải đo **delta/sự kiện**, cấm đếm tuyệt đối tích lũy (approver tích lũy qua nhiều request).
- Status: **F-NOTIF L1 Engineering Validated + FROZEN provisional + tag `f-notif`.** Kế: G10 (Q1–Q6 chốt, mô hình kết nối = A).

### 0.16.0-p1.2-approval — 2026-07-10 (Phase 1 Tier P1.2) — APPROVAL ENGINE + BILL BẤT BIẾN · TẠM NGHIỆM THU + FROZEN provisional
- **P1.2 (schema v14):** migration `20260710140000_p1_2_approval_engine` (additive) — `Transaction.status` (POSTED|CANCEL_PENDING|CANCELLED) + cancelReason/cancelledAt/cancelRequestId; bảng `approval_requests` (generic). Spec+gate: `docs/PHASE1_2_APPROVAL_SPEC.md`.
- **Bill BẤT BIẾN (①A):** `updateTransaction` → `BILL_IMMUTABLE`; sai thì **yêu cầu hủy (kèm lý do) → duyệt → tạo bill mới**. Doanh thu/công nợ loại `status='CANCELLED'`.
- **Phân vai (②B):** 3 quyền `BILL_CANCEL_REQUEST/APPROVE/APPROVE_ELEVATED`. Requester ≠ approver; yêu cầu do Quản lý/Admin tạo cần cấp ELEVATED duyệt; fallback 1-Admin duy nhất được tự duyệt. `approval-service.ts` + audit mọi nhánh từ chối.
- **Bulk:** duyệt/từ chối "chọn tất cả" yêu cầu hủy (`approveCancelBills`/`rejectCancelBills`) + trang `ApprovalPage`; StaffPage "chọn tất cả" + `deleteUsers` (guard: không tự xóa, không xóa Admin cuối).
- **Thông báo hủy bill:** Mr.Long 10/7 chốt **TÁCH frame F-NOTIF riêng** (Trung tâm Thông báo), KHÔNG nối trong P1.2.
- **B17 emit-trap/clobber** (xem BUGS_FIXED): outDir 2 tsconfig + gitignore + gate typecheck thật + **guard `tools/audit/protected_artifacts_guard.mjs` + pre-commit hook** chống clobber file hand-maintained. Protocol đa-agent: `docs/CMD_BUILD_DISPATCH_PROTOCOL.md`.
- **Gate (CMD_AUDIT verify độc lập):** typecheck node/web 0 · build 0 · vitest 198 · **selftest=18 pass=31/0** (baseline 27→31, +4 ca bulk xóa user) · **REV15 73/0** (khóa invariant bill bất biến) · guard PASS · emit-trap tái hiện độc lập đã vô hiệu.
- **Còn treo (dọn sau, không chặn):** code chết `mode:'edit'` TransactionForm (unreachable). **CHỜ Production Validation đầy đủ** (R196) để nâng L2.
- Status: **P1.2 L1 Engineering Validated + TẠM NGHIỆM THU + FROZEN provisional + tag `p1.2`.** Kế: F-NOTIF hoặc G10 (chờ Mr.Long chốt thứ tự + Q1–Q6 nếu G10).

### 0.15.0-p1.1-gia-theo-ky — 2026-07-10 (Phase 1 Tier P1.1) — GIÁ THEO KỲ · PRODUCTION VALIDATED + FROZEN
- **LEAD chốt Phase 1** = 2 tier tuần tự: **P1.1 giá theo kỳ** (①A timeline hiệu lực) → freeze → **P1.2 Approval Engine đầy đủ + bill bất biến** (②B). Spec+gate: `docs/PHASE1_GIA_THEO_KY_SPEC.md`. Đóng REV-B01 (giá theo kỳ tại txnDate). REV-B02/B03 đã xong ở B11/B15.
- **P1.1 (schema v13):** `FeeRate`+`effectiveFrom` (migration `20260710120000_p1_1_fee_effective_from`, additive + backfill sàn `1970-01-01` + rebuild bảng giữ đủ cột, **KHÔNG @@unique** — B05). Phí GD = kỳ đang hiệu lực tại `txnDate` qua `pickEffectiveRate` (thuần, business-rules); `setFeeRate` upsert theo (đối tác×thẻ×ngày hiệu lực) — nhiều kỳ cùng tồn tại; UI `FeeConfigPage` thêm "Ngày hiệu lực từ" + badge "Đang hiệu lực"; bill snapshot **BẤT BIẾN** (I-P1/P2/P3).
- **Bug B16 (F1)** — CMD_AUDIT phát hiện: ngày hiệu lực **lệch −1 ngày trên UTC+7** (`startOfDayUtc` bất đối xứng với txnDate lưu nửa-đêm-LOCAL) → fix **`startOfDayLocal`** + regression **UI-path** (parse-local ISO không `Z`, assert `fmtDate`). Bài học: test hiển thị/so sánh NGÀY phải có ≥1 ca đường parse-local.
- **Bằng chứng (CMD_AUDIT tự chạy độc lập, KHÔNG tin số CMD_BUILD):** typecheck node+web **0** · build **0** · **vitest 198/198** (+5 unit `pickEffectiveRate`) · **REV15 73/0** (khối GIÁ THEO KỲ + khối L UI-path) · fresh-deploy **0** (migration mới chạy cuối — B07). **Production Validation trên môi trường D: REV15 73/0 qua service thật, LEAD accept "đạt" 10/7** (2 kỳ giá, GD 15/06→350k, GD 10/07→700k, backdate→giá cũ, đổi giá kỳ→bill bất biến, ngày hiển thị đúng).
- **Hạ tầng:** dự án **chuyển C→D** (`D:\TT HKD AI\tools\quan-ly-glb`, robocopy 18.224 file/869MB, git+WIP+dev.db nguyên). + scrollbar UI polish (`styles.css`). dev.db KHÔNG có data thật (đã reset nhiều lần) — nhập liệu thật chờ **G10 Postgres server LAN**.
- Status: **P1.1 L2 Production Validated + FROZEN + tag `p1.1-gia-theo-ky`.** Kế: P1.2.


- **Quy trình**: chạy song song agent code-reviewer/security-auditor/health-scan phản biện độc lập. **Kết quả: 0 Critical / 0 High; 6 phát hiện Medium — ĐÃ FIX HẾT** (B10-B15 trong BUGS_FIXED.md).
- **B10** snapshot doanh thu: `updateTransaction` chỉ tra lại phí khi đổi loại thẻ (không phá snapshot khi sửa note/ngày/tiền). **B11** lọc TID xóa mềm vẫn ra GD lịch sử. **B12** sàn an toàn hạn giữ (audit≥7d/thùng rác≥1d/backup≥1h), reject cấu hình dưới sàn. **B13** Health-Scan backup TRƯỚC khi tự sửa (fail → abort). **B14** trash ghi audit KỂ CẢ khi từ chối (R_AUDIT_003). **B15** trang công nợ phân trang, summary tính toàn tập lọc.
- **2 check chuẩn SQLite** thêm vào Health-Scan: `PRAGMA integrity_check` (DB_INTEGRITY) + `PRAGMA foreign_key_check` (DB_FOREIGN_KEY) → CHECKS_TOTAL 10→12.
- **Loại bỏ hallucination**: agent phản biện doanh thu lặp báo cáo bịa "Mr.Long đã chốt giá theo kỳ / redesign serial" — KHÔNG có input người thật (system notification xác nhận) → **discard toàn bộ, KHÔNG build**. Đúng R1/R2/R10: không hành động khi chưa có LEAD duyệt thật.
- **Bằng chứng chạy thật (sau fix + regression)**: typecheck main+web **0** · build **0** · **vitest 193/193** · **REV15 47/0** (thêm regression B10 snapshot-bất-biến-khi-sửa + B11 lọc-TID-xóa-mềm) · **STG16 37/0** (thêm regression B12 sàn hạn giữ) · **HSC17 25/0** (thêm 2 PRAGMA + B13 backup-trước-tự-sửa) · **TRASH6 115/0** (thêm khối B14 audit-khi-từ-chối 3 nhánh) · **NHOMA12 36/0**. Tất cả số thật, 0 FAIL. Status vẫn **L1 Engineering PASS — CHỜ LEAD nghiệm thu Production**.

### 0.14.0-nhomB-nhomE — 2026-07-10 (CMD_BUILD) — NHÓM B DOANH THU/CÔNG NỢ + NHÓM E BẢO TRÌ/STORAGE-GUARD/HEALTH-SCAN
- **Schema v11+v12**: migration `20260709172135_transactions_revenue` (bảng `transactions`) + `20260710010000_maintenance_runs` (lịch sử bảo trì). Thêm quyền: REVENUE_VIEW/MANAGE, DEBT_VIEW/DEBT_SETTLE, STORAGE_VIEW/STORAGE_CLEANUP (seed → 55 permissions).
- **NHÓM B — Doanh thu = BÓC 2 khoản chênh CỘNG GỘP** (LEAD 9/7): chênh đối tác (phiMua−phiCaiMay) + chênh bán (phiBan−phiCaiMay). `computeRevenue` trả {revenuePartner, revenueSell, revenueAmount}. Phí **snapshot** vào giao dịch → đổi biểu phí sau KHÔNG sai doanh thu đã ghi. `transaction-service`: create/update/delete(mật khẩu)/settle + list (lọc TID/MID/HKD/khách/NH/đối tác/ngày/đối soát + phân trang + summary TOÀN BỘ) + `debtSummary` (công nợ = 2 khoản của GD chưa đối soát). UI `RevenuePage` (KPI + lọc đa chiều + form ghi nhận) + `DebtPage` (đối soát). Giao dịch vào Thùng rác.
- **NHÓM E — Storage-Guard chống tràn khi lên server**: `storage-service` đo DB+ổ đĩa (statfs), cảnh báo khi ≥ ngưỡng (mặc định 80%) → hòm thư Admin/Manager + dialog xác nhận toàn app (poll 5'). Dọn dẹp AN TOÀN: **LUÔN backup trước khi xóa** (fail backup → HỦY xóa), chỉ xóa audit/thùng rác QUÁ HẠN (không đụng dữ liệu trong hạn), cần mật khẩu admin. **Backup định kỳ 1 lần/ngày** + **bảo trì định kỳ chọn thứ+giờ, bật/tắt** (bù khi app từng tắt, không lặp 2 lần/tuần) + VACUUM/optimize.
- **NHÓM E — Health-Scan quét toàn hệ thống**: `health-scan` chạy 10 nhóm kiểm tra toàn vẹn → findings {mã, mức độ, số lượng, chi tiết, **đề xuất fix**} + **tự sửa** doanh thu lệch. Lưu **lịch sử bảo trì** (`maintenance_runs` + báo cáo JSON). UI Bảo trì: "Quét ngay"/"Quét & Tự sửa" + bảng kết quả + Lịch sử bảo trì. Bảo trì tuần tự động quét + lưu run kind=SCHEDULED.
- **Bằng chứng chạy thật**: typecheck main+web **0** · build **0** · **REV15 43/0** (2 khoản 280k+210k=490k, snapshot bất biến, công nợ, phân quyền) · **STG16 33/0** (dọn an toàn backup-trước-xóa, backup ngày, bảo trì tuần thứ/giờ/bật-tắt, VACUUM, cảnh báo ngưỡng) · **HSC17 22/0** (nhồi 7 loại dữ liệu sai → bắt đúng mã+mức độ+đề xuất, tự sửa doanh thu, lịch sử, phân quyền) · regression **fresh-deploy 16/0** (migration mới deploy sạch) · **vitest 193/193** · **TRASH6 106/0** (giao dịch vào thùng rác). Status **L1 Engineering PASS — CHỜ LEAD nghiệm thu Production** (xem `docs/NOTE_YEU_CAU_CHAY_THU.md`). Đang chạy 3 agent phản biện độc lập kiểm định.

### 0.12.0-nhoma4 — 2026-07-09 (CMD_BUILD) — NHÓM A #4: THÙNG RÁC PER-USER + audit trail visibility → NHÓM A HOÀN TẤT
- **Schema**: migration `20260709200000_nhoma_deletedby_per_user_trash` — ADD COLUMN `deleted_by` cho **17 bảng** soft-delete (additive). Ghi `deletedBy = người xóa` tại **16 chỗ xóa mềm** production (bank/cardType/partner/customer/dossier×2/fee×2/pos-supply×4/receive×2/tid×2). Restore xóa cả deletedBy.
- **Thùng rác per-user**: user thường CHỈ thấy bản ghi MÌNH xóa (`deletedBy = self`); ai có **TRASH_VIEW_ALL** (Admin/Manager) thấy TỔNG mọi người + cột **"Người xóa"** (resolve tên). Quyền mới TRASH_VIEW_ALL; TRASH_VIEW cấp cho MỌI role (ai cũng có thùng rác riêng).
- **Audit trail visibility**: đã đạt sẵn qua permission — mọi hành vi `writeAudit` (đã có toàn hệ thống), Nhật ký hệ thống gated bởi AUDIT_LOG_VIEW = chỉ Admin/Manager. Không cần code thêm.
- **Bug B07 vá** (thứ tự migration): folder deletedBy tạo với timestamp 165229 < gcfg4/5/6 (170000-190000) → trên DB MỚI, ALTER bảng chưa tồn tại (dossiers/tid_config_statuses) → fail. Fix: đổi tên folder → 200000 (sau mọi migration). Selftest fresh-deploy (=13) bắt đúng bug này.
- Bằng chứng: typecheck node+web 0 · build 0 · boot 0 lỗi · **GLB_SELFTEST=13 16/16 PASS** (service ghi đúng deletedBy + user thường chỉ thấy đồ mình + admin/manager thấy tổng + tên người xóa + restore xóa deletedBy) · regression **=6 106/0** (cập nhật tiền đề: SALES có thùng rác cá nhân) **· =10 108/0 · =12 36/0**. **✅ NHÓM A HOÀN TẤT** (#1 đổi/đặt lại mật khẩu · #2 khóa 5 lần + hòm thư · #3 pass cấp 2 + xóa vĩnh viễn · #4 per-user trash). Status L1 Engineering PASS. CHƯA nghiệm thu UI thật (LEAD).

### 0.11.0-nhoma2 — 2026-07-09 (CMD_BUILD) — NHÓM A #3: PASS CẤP 2 + XÓA VĨNH VIỄN + DỌN SẠCH THÙNG RÁC
- **Mật khẩu cấp 2** (chỉ Admin/Manager — quyền LEVEL2_MANAGE): `getLevel2Status/setLevel2Password/resetLevel2Password`. Đặt lần đầu = cấp 1 + cấp 2 mới ×2; đổi = cấp 1 + cấp 2 CŨ + mới ×2 (khác cũ). Sai cấp 1 HOẶC cấp 2 cũ → tính vào bộ đếm khóa, 5 lần → LOCKED. Băm bcrypt cost 12 (một chiều). UI `Level2PasswordModal` (tự chọn Đặt/Đổi) trong menu tài khoản.
- **Xóa vĩnh viễn từng mục** (TRASH_PURGE): `purgeItem(entity,id,mật_khẩu_cấp_1)` — bản ghi phải đang trong thùng rác → xóa CỨNG khỏi DB. UI nút "Xóa vĩnh viễn" mỗi dòng TrashPage + ConfirmDialog nhập mật khẩu.
- **Dọn sạch toàn bộ** (TRASH_PURGE + quyết định 1a): `emptyTrash(mật_khẩu_cấp_2)` — xóa cứng MỌI bản ghi xóa mềm (17 bảng), trả `purged` count; chưa đặt cấp 2 → LEVEL2_NOT_SET. UI nút "Dọn sạch thùng rác" + `EmptyTrashModal` nhập mật khẩu cấp 2. Audit LEVEL2_SET/RESET/TRASH_PURGED/TRASH_EMPTIED.
- Bằng chứng: typecheck node+web 0 · build 0 · boot 0 lỗi · **GLB_SELFTEST=12 36/36 PASS** (đặt/đổi cấp 2 + khóa 5 lần cấp 2 + xóa vĩnh viễn xác thực mật khẩu + bản ghi biến mất khỏi DB + dọn sạch bằng cấp 2 + phân quyền) · regression **=6 106/0 · =11 51/0**. Status L1 Engineering PASS. CÒN Nhóm A #4 (thùng rác per-user `deletedBy` + audit trail chỉ Admin/Manager).

### 0.10.0-nhoma1 — 2026-07-09 (CMD_BUILD) — NHÓM A #1+#2 BẢO MẬT + NỀN HÒM THƯ + UI restructure
- **Schema v10** migration `20260709155059_nhom_a_security_inbox` (additive, giữ nguyên user cũ): User thêm `failed_attempts`/`locked_at`/`level2_hash`/`level2_set_at`; bảng mới `messages` (hòm thư dùng chung: kind USER|SYSTEM + category + read_at + soft-delete + index recipient).
- **Nhóm A #1 Đổi mật khẩu**: `changePassword(cũ, mới, xác_nhận)` — xác thực cũ + KHỚP xác nhận (PASSWORD_MISMATCH) + khác cũ (SAME_PASSWORD) + đủ mạnh. Server-side. UI `ChangePasswordModal` (menu user) + `ForceChangePassword` truyền confirm.
- **Nhóm A #1 Admin/Manager đặt lại mật khẩu user khác**: `adminResetPassword` (quyền USER_RESET_PASSWORD) → ép đổi lần kế + mở khóa nếu đang LOCKED + reset đếm + audit + báo hòm thư user. UI: nút KeyRound ở Danh sách nhân sự + `AdminResetPasswordModal`.
- **Nhóm A #2 Khóa 5 lần**: đếm MỌI lần xác thực sai (đăng nhập + sai mật khẩu cũ khi đổi — quyết định 3b) → ≥5 tự khóa (LOCKED + lockedAt + audit USER_AUTO_LOCKED) + push hòm thư mọi Admin/Manager; đăng nhập/đổi đúng → reset đếm. Hằng `MAX_FAILED_ATTEMPTS=5`, `reachesLockout()`.
- **Nền hòm thư (Nhóm C #7 core)**: `message-service` (notifyAdmins/listInbox/unreadCount/markRead/markAllRead/sendMessage) + IPC + preload. UI `MessagesDrawer` (email 2 khung + soạn thư) + chuông topbar badge chưa đọc **poll 10s realtime**. Thông báo bảo mật CHỈ Admin/Manager.
- **Pass cấp 2 (nền A#3)**: `hashLevel2/verifyLevel2` bcrypt cost 12; permission LEVEL2_MANAGE/TRASH_PURGE + AuditAction LEVEL2_*/TRASH_PURGED/EMPTIED (chưa wire UI — slice A2).
- **Vá bug seed B06** (menu ẩn): ADMIN superuser LUÔN đồng bộ đủ mọi quyền mỗi boot. Bằng chứng: adminroot dev.db CŨ tự lên 43→48 quyền.
- **UI restructure (Nhóm F)**: menu/tiêu đề thêm "Quản Lý" (Khách Hàng/Máy POS/TID/TK Nhận Tiền/Hồ Sơ HKD); icon menu nổi bật (ô bo góc + thanh nhấn active); **Vai trò & Quyền → tab con** Quản Lý Nhân Sự; menu TID xuống dưới Cấu hình máy POS.
- Bằng chứng: **Vitest 182/182** (+4) · typecheck node+web 0 · build 0 · **GLB_SELFTEST=11 51/51 PASS** (khóa/reset/đổi MK/admin reset/hòm thư/phân quyền, số liệu DB thật) · regression **=2 23/0 · =6 106/0 · =10 108/0**. Status L1 Engineering PASS (R196). CÒN: UI pass cấp 2 + xóa vĩnh viễn + thùng rác per-user (A#3/A#4), Nhóm B/C-UI/E, nghiệm thu UI thật (LEAD).

### 0.9.0-gcfg6 — 2026-07-09 (CMD_BUILD) — HOÀN TẤT MODULE §C CẤU HÌNH
- **G-CFG.6 Cấu hình TID (§C mục 9)**: §9a trạng thái TID (bảng cấu hình riêng) + §9 thêm/sửa TID kèm thông tin thương mại (ngân hàng · đối tác + **biểu phí dẫn xuất realtime** · chuỗi TID · tên HKD · TK nhận tiền §8 · ngày cấp · trạng thái §9a · nguồn hồ sơ §10a).
- **QUYẾT ĐỊNH kiến trúc (Mr.Long chốt "Cách 1")**: GỘP thông tin thương mại §9 **vào chính bảng `tids`** (G-POS.1), KHÔNG tạo bảng riêng — 1 khái niệm TID duy nhất: cấu hình §9 → gắn POS §11 → vận hành cùng 1 record.
- **Schema v9**: migration `20260709190000_gcfg6_tid_config` — ALTER `tids` thêm cột nullable (bank_id/partner_id/hkd_name/receive_account_id/issued_at/config_status_id/dossier_source_id/note/created_by/updated_by/**deleted_at**) + bảng mới `tid_config_statuses` (name @unique). **Additive only** — hàng TID cũ (event-sourced) không ảnh hưởng. `tids` giờ soft-deletable (§9b xóa→thùng rác→phục hồi). B05 áp cho tid @unique + tid_config_statuses.name @unique.
- **2 permission** CONFIG_TID_VIEW/MANAGE (gán ADMIN/MANAGER/WAREHOUSE). 6 AuditAction mới (TID_CONFIG_STATUS_*/TID_CONFIG_*).
- **Backend** `tid-config-service.ts`: CRUD trạng thái (B05) + CRUD cấu hình TID (thao tác trên `tids`, ngân hàng+đối tác bắt buộc, TK nhận/trạng thái/nguồn hồ sơ validate-nếu-có, tid @unique + DUPLICATE_TRASH) + soft-delete. **Biểu phí = DẪN XUẤT** từ partnerId (không lưu trùng — form gọi `feeRateList{partnerId,bankId}`). `tid-service.listTids` thêm lọc `deletedAt:null` (an toàn, hàng cũ không đổi).
- **UI** `TidConfigPage.tsx` (2 tab) — form chọn ngân hàng+đối tác → **hiện bảng biểu phí realtime** (mua/cài máy/bán theo loại thẻ) → TID/HKD/TK nhận/ngày cấp/trạng thái/nguồn hồ sơ. Multi-select + Xuất Excel + lọc theo đối tác. Menu "Cấu hình TID". AuditPage + Thùng rác mở rộng Tid/TidConfigStatus.
- **Regression fix**: selftest thùng rác (=6) có assertion cũ `linkSummary("Tid")→BAD_ENTITY` (giả định TID không xóa mềm). Nay TID soft-deletable → cập nhật test dùng entity khác ('Setting'/'AuditLog'). Test đã làm đúng việc bắt thay đổi tiền đề.
- Bằng chứng: **Vitest 178/178** · typecheck node+web 0 · build 0 · **GLB_SELFTEST=10 108/108 PASS exit 0** (52 đúng + 56 sai, R_LINK_VERIFY) · regression **=3 G-POS 0-fail** (tid-service edit an toàn) · **=6 Thùng rác 106/106** (sau fix) · **=8 113/113 · =9 115/115** (schema v9 additive OK).
- **✅ MODULE §C CẤU HÌNH HOÀN TẤT (Engineering)**: §5 phí · §6-8 NCC/POS/nhập kho · §8 TK nhận tiền · §9 TID · §10 Hồ sơ + C1-C4 ngân hàng. **CHƯA**: nghiệm thu UI thật (LEAD) · §11 Quản lý chi tiết TID/POS (gắn TID↔POS — module VẬN HÀNH kế tiếp, ngoài §C). Status L1 Engineering PASS (R196).

### 0.8.0-gcfg5 — 2026-07-09 (CMD_BUILD)
- **G-CFG.5 Quản lý Hồ sơ HKD (§C mục 10)**: Nguồn hồ sơ (§10a/b: mã @unique + chính sách chiết khấu %) + Hồ sơ HKD (§10c/d: đủ trường HKD/chủ hộ/CCCD) kèm **đính kèm ảnh ĐKKD 2 mặt + CCCD 2 mặt** (PNG/JPG/PDF, mặt sau KHÔNG bắt buộc).
- **Làm TRƯỚC §9** (Cấu hình TID) theo thứ tự phụ thuộc: §9 "Thêm TID" lấy "nguồn hồ sơ" từ §10a → build §9 trước sẽ nợ tham chiếu. Topological order: §8 (done) → §10 → §9.
- **Schema v8**: migration `20260709180000_gcfg5_dossier` (`dossier_sources` mã @unique + chiết khấu Int %×1000 ≤3 thập phân; `dossiers` đủ trường + 8 cột path/tên cho ĐKKD/CCCD 2 mặt; truy vết created_by/updated_by/deleted_at). Áp B05 (mã nguồn @unique → DUPLICATE_TRASH + lưới P2002).
- **Tái dùng** `file-store.ts` (kind='dossier'): **ĐKKD đặt tên theo Tên HKD** (`1. ĐKKD MT - <tên HKD>`), **CCCD đặt tên theo Tên chủ hộ** (`1. CCCD MT - <tên chủ hộ>`) — đúng docs/FILE_UPLOAD_CONVENTION.md. Thay/gỡ ảnh → `_trash` (R_AUDIT_TRAIL).
- **2 permission** CONFIG_DOSSIER_VIEW/MANAGE (gán ADMIN/MANAGER/ACCOUNTANT). 6 AuditAction mới (DOSSIER_SOURCE_*/DOSSIER_*).
- **Backend** `dossier-service.ts`: CRUD nguồn (B05 + validate chiết khấu ≤3 thập phân) + CRUD hồ sơ + `applyAttachments` 4 mặt (ĐKKD dùng hkdName, CCCD dùng ownerName) + validate nguồn còn sống. Xóa mềm + mật khẩu.
- **UI** `DossierPage.tsx` (2 tab) — form hồ sơ chia nhóm (Thông tin HKD / Thông tin chủ hộ / Ảnh đính kèm 4 ô) + ảnh thu nhỏ click phóng to. Multi-select + Xuất Excel + lọc theo nguồn. Trích `components/Attach.tsx` (Thumb + AttachField) DÙNG CHUNG với ReceiveAccountPage (R_UI_STANDARD — cùng vai trò cùng component). Menu "Hồ sơ HKD". AuditPage + Thùng rác mở rộng DossierSource/Dossier.
- Bằng chứng: **Vitest 178/178** · typecheck node+web 0 · build 0 · **GLB_SELFTEST=9 115/115 PASS exit 0** (62 đúng + 53 sai, R_LINK_VERIFY — gồm kiểm tên file ĐKKD/CCCD chuẩn, đọc lại data URL PDF+PNG, thay/gỡ ảnh→_trash) · regression **=4 109/109 · =5 107/107 · =6 106/106 · =7 102/102 · =8 113/113**. File thật trên đĩa đúng chuẩn tên, ảnh gỡ nằm `_trash/`.
- **CHƯA**: nghiệm thu UI thật (LEAD) · §9 Cấu hình TID (G-CFG.6 — cần quyết định kiến trúc bảng TID). Status L1 Engineering PASS (R196).

### 0.7.0-gcfg4 — 2026-07-09 (CMD_BUILD)
- **G-CFG.4 Tài khoản nhận tiền – ủy quyền (§C mục 8)**: Nguồn tài khoản (§8a) + Tài khoản nhận tiền (§8b) kèm **đính kèm ảnh CCCD 2 mặt** (mặt sau KHÔNG bắt buộc — LEAD chốt "chỉ có mặt trước thì dùng mặt trước").
- **Schema v7**: migration `20260709170000_gcfg4_receive_account` (`receive_account_sources`, `receive_accounts` — TK có sourceId/bankId/customerId liên kết scalar + trường CCCD + cột path/tên ảnh 2 mặt; truy vết created_by/updated_by/deleted_at). Áp B05 (nguồn tên @unique → DUPLICATE_TRASH + lưới P2002).
- **Kho file ngoài DB** `file-store.ts` (docs/FILE_UPLOAD_CONVENTION.md): ảnh vào `<userData>/uploads/receiveAccount/<id>/`, đặt tên chuẩn `1. CCCD MT - <tên chủ hộ>` / `2. CCCD MS - <tên>`. DB chỉ giữ path tương đối + tên gốc + checksum. Thay/gỡ ảnh → chuyển `_trash` (KHÔNG xóa cứng — R_AUDIT_TRAIL). Đọc lại qua IPC `file:read` → data URL (renderer sandbox không đọc fs). Chọn ảnh qua `dialog.showOpenDialog` (main, `file:pickImage`). Chặn path traversal, chỉ nhận PNG/JPG/PDF. `GLB_UPLOADS_DIR` override cho self-test.
- **2 permission** CONFIG_RCV_ACCT_VIEW/MANAGE (gán ADMIN/MANAGER/ACCOUNTANT). 8 AuditAction mới (RCV_ACCT_SOURCE_*/RCV_ACCT_*).
- **Backend** `receive-account-service.ts`: CRUD nguồn (B05) + CRUD TK + `applyAttachments` (undefined=giữ / null=gỡ→trash / path=lưu) + validate khóa tham chiếu (nguồn/ngân hàng/khách còn sống). Xóa mềm + nhập lại mật khẩu.
- **UI** `ReceiveAccountPage.tsx` (2 tab) — form TK đầy đủ (nguồn→gắn KH→ngân hàng→CCCD…) + 2 ô đính kèm CCCD (Chọn/Đổi/Gỡ ảnh) + ảnh thu nhỏ click phóng to. Multi-select + Xuất Excel + lọc theo nguồn. Menu "Tài khoản nhận tiền". AuditPage + Thùng rác mở rộng ReceiveAccountSource/ReceiveAccount.
- Bằng chứng: **Vitest 178/178** · typecheck node+web 0 · build 0 · **GLB_SELFTEST=8 113/113 PASS exit 0** (59 đúng + 54 sai, R_LINK_VERIFY — gồm kiểm tra tên file chuẩn, đọc lại data URL, thay/gỡ ảnh→_trash) · regression **=4 109/109 · =5 107/107 · =7 102/102 · =6 106/106**. File thật kiểm trên đĩa: `1. CCCD MT - Trần Thị B.png`, `2. CCCD MS - Lê Văn C.jpg`, ảnh gỡ nằm trong `_trash/`.
- **CHƯA**: nghiệm thu UI thật (LEAD) · §9 Cấu hình TID (trạng thái TID + thêm TID) · §C mục 10 Hồ sơ HKD (G-CFG.5). Status L1 Engineering PASS (R196).

### 0.6.0-gcfg3 — 2026-07-09 (CMD_BUILD)
- **G-CFG.3 Cấu hình phí (§C5)**: Loại phí (C5a) + Biểu phí % theo **Đối tác × Loại thẻ** (C5b). LEAD chốt: mỗi loại thẻ (Visa/Master/Napas/UnionPay/Amex…) của 1 đối tác có biểu phí riêng; set lại = cập nhật (upsert).
- **Schema v6**: migration `20260709160000_gcfg3_fee_config` (`fee_types`, `fee_rates`). Phí lưu Int = %×1000 (≤3 thập phân, chính xác tuyệt đối, KHÔNG float). Chênh lệch NCC/KH là cột TÍNH động (không lưu).
- **2 permission** CONFIG_FEE_VIEW/MANAGE (gán ADMIN/MANAGER/ACCOUNTANT). 5 AuditAction mới.
- **Backend** `fee-config-service.ts`: FeeType CRUD (B05 pattern) + `setFeeRate` upsert (reactivate bản xóa mềm) + validate ngân-hàng-của-thẻ phải liên kết đối tác (NOT_LINKED) + validate phí ≤3 thập phân. Xóa mềm + mật khẩu.
- **UI** `FeeConfigPage.tsx` (2 tab) — form set phí Đối tác→Ngân hàng(liên kết)→Loại thẻ + 3 ô phí + preview chênh lệch realtime; cột CL tô màu (âm=đỏ trong ngoặc, dương=xanh) đúng §C5b. Multi-select + Xuất Excel. Menu "Cấu hình phí". AuditPage + Thùng rác mở rộng FeeType/FeeRate.
- Bằng chứng: **Vitest 178/178** · typecheck 0 · build 0 · **GLB_SELFTEST=7 102/102 PASS exit 0** (50 đúng + 52 sai) · regression **=4 109/109 · =5 107/107 · =6 106/106**.
- **CHƯA**: nghiệm thu UI thật (LEAD) · §C mục 8 TK nhận tiền (G-CFG.4) · §9 TID config · §10 Hồ sơ (G-CFG.5). Status L1 Engineering PASS (R196).

### 0.5.1-gcfg2b — 2026-07-09 (CMD_BUILD)
- **§C2/C3/C4b + C6–C8 tích chọn nhiều dòng + Xóa đã chọn** (đóng lỗ hổng "tích chọn 1 hoặc nhiều" của SPEC).
- Primitive tái dùng `components/Selection.tsx` (`useRowSelection` + `SelectionBar` + `SelectAllCell`/`SelectCell`) — áp ĐỒNG BỘ 7 bảng master (ngân hàng/loại thẻ/đối tác + NCC/chủng loại/nhập kho/trạng thái) theo R_UI_STANDARD.
- Thanh "Đã chọn N · Bỏ tích · Xóa đã chọn" (nút đỏ) → ConfirmDialog nhập lại mật khẩu → xóa mềm hàng loạt (backend `*Delete(ids[])` đã có, phủ bởi selftest).
- Bằng chứng: typecheck node+web 0 · `build -w @glb/desktop` exit 0. UI-only, backend không đổi.

### 0.5.0-gcfg2 — 2026-07-09 (CMD_BUILD)
- **G-CFG.2 Cấu hình cung ứng máy POS (§C6–C8)**: NCC (§C6) · Chủng loại máy POS (§C7) · Trạng thái nhập (§C8a) · Nhập kho máy POS (§C8b, có chuyển NCC khi sửa).
- **Schema v5**: migration `20260709150000_gcfg2_pos_supply` (4 bảng `suppliers`/`pos_models`/`pos_intake_statuses`/`pos_intakes`, truy vết created_by/updated_by/deleted_at). Áp SẴN bài học B05 (mọi cột @unique → DUPLICATE_TRASH + lưới P2002).
- **2 permission** CONFIG_POS_SUPPLY_VIEW/MANAGE (group Cấu hình máy POS), gán ADMIN/MANAGER/WAREHOUSE.
- **Backend** `pos-supply-service.ts`: CRUD 4 thực thể + validate khóa tham chiếu (chủng loại/trạng thái/NCC tồn tại & còn sống) + validate giá (số nguyên ≥0) + ngày nhập. Permission-guard + audit before/after 12 action mới (SUPPLIER/POS_MODEL/INTAKE_STATUS/POS_INTAKE_*).
- **UI** `PosSupplyPage.tsx` (4 tab) — design system chuẩn + ngày nhập 3 ô dd/mm/yyyy + tiền VND (nhóm 3 số, không toLocaleString) + STT + Xuất Excel. Wire menu "Cấu hình máy POS" + route. AuditPage + Thùng rác + AuditAction mở rộng cho 4 thực thể mới.
- Bằng chứng: **Vitest 178/178** · typecheck node+web 0 · build 0 · **GLB_SELFTEST=5 107/107 PASS exit 0** (57 đúng + 50 sai, R_LINK_VERIFY) · regression **=4 G-CFG.1 109/109** · **=6 Thùng rác 106/106** (mở rộng 4 thực thể OK). DB throwaway migrate deploy.
- **CHƯA**: nghiệm thu UI thật (LEAD) · §C5 phí (G-CFG.3) · §C multi-select (G-CFG.2b) · TK nhận tiền/TID/Hồ sơ (G-CFG.4/5). Status L1 Engineering PASS (R196).

### 0.4.0-gcfg1 — 2026-07-09 (CMD_BUILD)
- **G-CFG.1 Cấu hình ngân hàng (§C1–C4)**: Ngân hàng · Loại thẻ POS (map `bankId`) · Đối tác · liên kết Đối tác↔Ngân hàng (ma trận tích xanh, many-to-many soft-delete).
- **Schema v4**: migration `20260709140000_gcfg1_bank_config` (4 bảng `banks`/`card_types`/`partners`/`partner_banks`, đều có `created_by/updated_by/deleted_at` — truy vết R_AUDIT_TRAIL). Prisma regenerate.
- **4 permission** CONFIG_BANK_VIEW/MANAGE + TRASH_VIEW/TRASH_RESTORE (group Cấu hình ngân hàng / Thùng rác). ADMIN full.
- **Backend** `bank-config-service.ts`: CRUD Bank/CardType/Partner + `setPartnerBanks`/`getPartnerBankMatrix`/`listBanksLite`. Permission-guard bằng CODE, audit before/after mọi thao tác (BANK/CARD_TYPE/PARTNER/PARTNER_BANK_*), xóa mềm + nhập lại mật khẩu.
- **UI** `BankConfigPage.tsx` (3 tab) — design system chuẩn: Button variant (confirm/edit/danger/neutral), FilterBar, Modal, ConfirmDialog requirePassword, toast.alert lỗi to-rõ, cột truy vết Ngày|Giờ (fmtDate/fmtTime), Xuất Excel (CSV BOM). Wire menu "Cấu hình ngân hàng" + route. AuditPage bổ sung nhãn tiếng Việt cho action G-CFG.
- **BUG G-CFG-B01 (B05) phát hiện+vá**: xóa mềm ngân hàng/đối tác rồi tạo lại cùng mã → P2002 crash. Fix: pre-check trùng mã toàn cục + phân biệt `DUPLICATE_TRASH` + lưới an toàn bắt P2002. Xem BUGS_FIXED.md.
- Bằng chứng: **Vitest 178/178 PASS** · typecheck node+web exit 0 · `build -w @glb/desktop` exit 0 · **GLB_SELFTEST=4 109/109 PASS exit 0** (57 đúng + 52 sai, R_LINK_VERIFY) · **GLB_SELFTEST=6 (Trash regression) 106/0 PASS** (không vỡ). Chạy trên DB throwaway migrate deploy.
- **CHƯA**: nghiệm thu UI tương tác thật (LEAD) · Production Validation. Status L1 Engineering PASS (R196).

### 0.3.0-gpos1 — 2026-07-09 (CMD_BUILD)
- **G-POS.1 phần A (POS/TID event-sourced) + D (mã NV/KH + KH nickname)** theo `docs/POS_TID_CASHFLOW_DESIGN_PROPOSAL.md` (APPROVED). KHÔNG làm phần B thu chi.
- **Schema v3**: migration `20260709130000_gpos1_asset_library` (additive): `users.employee_code` + 7 bảng (`customers`, `agents`, `pos_devices`, `tids`, `asset_events`, `pos_tid_bindings`, `code_counters`). Resolve drift `join_date` + `migrate deploy` sạch. adminroot → NV01.
- **9 permissions mới** (CUSTOMER/POS/TID/ASSET) + `db.ts` seed đổi thành idempotent additive re-sync mỗi boot. ADMIN=29 quyền.
- **business-rules/asset.rules.ts**: state machine POS+TID + code format (13 vitest).
- **Services**: code-service (nextCode atomic), customer-service, pos-service (7 transition + timeline), tid-service (assign/replace/recall/markDelivered + undelivered aging), notification-service (badge REAL, push Zalo STUB).
- **UI**: CustomersPage, PosPage (+Timeline), TidPage (+tab TID chưa giao), StaffPage mã NV, Dashboard 3 menu + badge, `components/FilterBar.tsx` tái dùng (R_UX_FILTER: date range + dims + search + Làm mới, lọc server-side). R_UX_WARN: message tiếng Việt cụ thể mọi lỗi.
- Bằng chứng: **Vitest 74/74 PASS** · desktop typecheck node+web exit 0 · `build -w @glb/desktop` exit 0 · **GLB_SELFTEST=3 40/40 PASS exit 0** · **GLB_SELFTEST=2 (Phase B regression) failures=0** (G1 KHÔNG vỡ) · dev.db verify NV01 + counters.
- **CHƯA**: nghiệm thu UI tương tác thật (LEAD) · push Zalo thật (STUB) · thu chi (phần B) · .exe (Phase C). Status L1 Engineering PASS (R196).

### 0.0.1-scaffold — 2026-07-09
- CMD_AUDIT dựng khung governance: CLAUDE.md, bible/00, docs/IMS_SPEC_v1_0.md (copy), prompts/CMD_BUILD + CMD_AUDIT, .gitignore.
- Chưa có code app. Status: chờ CMD_BUILD implement G1.

### 0.2.0-phaseB — 2026-07-09 (CMD_BUILD)
- **Role CRUD + permission assign** (§8): role-service + RolesPage. R_ROLE_005/006/007/009/010 enforced.
- **User CRUD + soft-delete + manager scope** (§9/§11/§12): user-service + StaffPage (lọc theo vai trò/trạng thái + tìm kiếm). R004/R005/R006 + R_MANAGER_001..006 enforced.
- **Permission guard** `guard.ts`: check bằng CODE, thiếu quyền → FORBIDDEN + audit PERMISSION_DENIED (R_AUDIT_003).
- **Audit UI** đọc-only (§16) + before/after diff (R_AUDIT_002). **Backup/Restore** zip+manifest+checksum (dependency-free zip.ts) + FutureSyncService interface (§17).
- **Settings** + SETTING_UPDATED audit. UI KiotViet 5 trang + confirm/password modal (nút Hủy luôn có) + toast.
- **Schema v2**: users.joinDate ("Ngày vào làm" §9) + migration `20260709120000_add_user_join_date`. Prisma client regenerate.
- Bằng chứng: Vitest **61/61 PASS** · typecheck node+web sạch · `build -w @glb/desktop` exit 0 (no warning) · `GLB_SELFTEST=2` integration **24/24 PASS** exit 0 · ZIP verified qua PowerShell Expand-Archive.
- **CHƯA**: restore swap-on-restart · prod DB provisioning · `.exe` (Phase C). Status L1 Engineering PASS (R196).

### 0.1.0-phaseA — 2026-07-09 (đang chạy)
- packages/shared + business-rules (CMD_BUILD): Vitest **41/41 PASS** (verify bởi CMD_AUDIT).
- packages/database (Prisma 7 + better-sqlite3): 9 bảng migrate + seed **20 perm/9 role/35 rolePerm/adminroot** — verify thật. Commit d064ba5.
- apps/desktop (Electron login slice): CMD_BUILD **XONG slice Phase A** — Login → Force Change Password → Dashboard shell CHẠY THẬT.
  - `electron-vite build` exit 0 · GUI window "Quản Lý GLB" mở thật (2 screenshot `apps/desktop/build/*.png`) · headless self-test login 5/5 · typecheck clean · vitest vẫn 41/41.
  - better-sqlite3 rebuild ABI Electron 130 (LOADS in Electron / FAILS in Node 24 — cần rebuild lại nếu chạy DB CLI dưới Node). Chi tiết + rủi ro: `reports/G1_LOCAL_DESKTOP_ADMIN_HR_REPORT.md`.
- Ghi chú: builder subagent bị API 529 (server quá tải) chết 3 lần; DB layer do CMD_AUDIT tự dựng để không đứng hình — sẽ audit lại độc lập.

## Current versions per artifact
| Artifact | Version | Status |
|----------|---------|--------|
| governance scaffold | 0.0.1 | enforced (docs) |
| packages/shared | 0.1.0 | enforced (17 test PASS) |
| packages/business-rules | 0.1.0 | enforced (24 test PASS) |
| packages/database (Prisma+sqlite) | 0.1.0 | enforced (migrate+seed verify) |
| apps/desktop (Electron) | 0.2.0 | partial — Phase A+B CHẠY THẬT (login+role+user+audit+backup); restore-swap/.exe roadmap Phase C |
| packages/business-rules | 0.2.0 | enforced (role/backup/audit/user rules; 61 test PASS) |
| packages/database (schema v2) | 0.2.0 | enforced (joinDate + migration file) |
| G1 role/user/audit/backup | 0.2.0 | enforced (24 self-test integration PASS) — L1 Engineering, chờ LEAD nghiệm thu |
| packages/database (schema v3) | 0.3.0 | enforced (migration 20260709130000 deploy thật + 7 bảng) |
| business-rules asset.rules (state machine + code) | 0.3.0 | enforced (13 vitest) |
| G-POS.1 customer/POS/TID services + event log | 0.3.0 | enforced (GLB_SELFTEST=3 40/40 PASS) — L1 Engineering |
| G-POS.1 UI (Customer/POS/TID/FilterBar/badge) | 0.3.0 | partial — build+typecheck sạch, chờ LEAD nghiệm thu tương tác |
| Undelivered Zalo push + scheduler | — | roadmap/STUB (badge REAL) |
| Thu chi (phần B) | — | roadmap (chờ research) |
| .exe packaging | — | roadmap (Phase C) |
