# PHASE H — QUẢN LÝ THU – CHI (CASHFLOW) — DESIGN SPEC

> Trạng thái: **DRAFT — chờ Mr.Long chốt (R7 Read→Diff→Proposal→Approval)**. KHÔNG build tới khi duyệt.
> Kiến trúc sư thiết kế 10/7. Grounded trên code THẬT của `quan-ly-glb` (schema.prisma, transaction-service, approval-service, dashboard-service, DebtPage) + 2 tài liệu nghiên cứu (`CASHFLOW_MARKET_RESEARCH.md`, `POS_TID_CASHFLOW_DESIGN_PROPOSAL.md`).
> Nguồn phạm vi (chân lý): `Desktop/báo cáo - Copy.md` mục **A→K** + 2 bổ sung LEAD 10/7 (Lợi nhuận Dashboard · Phân loại chất lượng công nợ).
>
> **Nguyên tắc tối thượng của module:** mọi đồng tiền vào/ra hệ thống đi qua **đúng 1 chứng từ nguyên thủy `CashEntry` (phiếu thu/phiếu chi)**. Mọi nghiệp vụ khác (tạm ứng, cọc máy, hoàn cọc, chi lương, thu công nợ) là **chứng từ nghiệp vụ** — khi POSTED **sinh đúng 1 `CashEntry` liên kết**. Nhờ vậy: **Quỹ = Σ CashEntry** luôn cân, KHÔNG bao giờ đếm trùng.

## ✅ QUYẾT ĐỊNH MR.LONG CHỐT 10/7 (khóa — agent build theo đây)
| # | Vấn đề | CHỐT |
|---|---|---|
| Q-A | **Lợi nhuận Dashboard** | **Theo DOANH THU GHI NHẬN (accrual)**: `Lợi nhuận tháng = Σ chênh lệch GD (Transaction, theo txnDate trong tháng) − Σ phiếu chi thực (CashEntry CHI trong tháng)`. **KHÔNG** cash-basis. Thu công nợ = chuyển "phải thu → tiền", KHÔNG tính là doanh thu mới (chống đếm trùng). |
| Q-B | **Phiếu chi có cần duyệt?** | **KHÔNG cần duyệt.** Chỉ ghi audit đầy đủ (người chi, danh mục, số tiền, ngày, hình thức). (KHÁC hủy bill — không qua Approval Engine.) |
| Q-C | **Nợ "không thu hồi được" (BAD)** | **Chỉ CỜ CẢNH BÁO ĐỎ** trên DebtPage + Dashboard. **KHÔNG tự ghi giảm** lợi nhuận. (Muốn ghi giảm = thao tác riêng sau, chưa làm.) |
| Q-D | **Admin đặt lại MK user khác** (lỗ hổng an ninh) | Bắt admin **nhập lại MK ĐĂNG NHẬP của chính mình** (re-auth) → backend verify trước khi reset. *(việc security riêng, không thuộc module thu-chi nhưng ghi ở đây để không quên.)* |
| Q-E | **Mã theo vai trò** | **C: giữ mã NV ổn định + badge vai trò màu (AD/QL/NV) cạnh mã.** KHÔNG ghép chữ vai vào mã (tránh lỗi mã-cố-định-khi-đổi-vai). |

> Các câu §9 còn lại (định nghĩa "số máy chưa cọc" Q6...) vẫn chờ; agent build tới pha liên quan sẽ hỏi.

---

## 0. Ánh xạ A→K (+2 bổ sung) → thành phần thiết kế

| Mục báo cáo | Yêu cầu cốt lõi | Bảng dữ liệu | Service/Trang | Pha |
|---|---|---|---|---|
| **A** Danh mục khoản THU | Thêm loại thu (Công nợ KH, Công nợ đối tác, DT bán POS, DT bán TID, DT khác…) + đơn vị tính + kỳ áp dụng | `CashCategory(kind=THU)` | `cash-category-service` · Trang *Cấu hình danh mục thu-chi* | **H1** |
| **B** Danh mục khoản CHI | Tương tự A | `CashCategory(kind=CHI)` | như trên | **H1** |
| **C** Tạm ứng | Hạng mục, người chi ứng, người nhận, CK/tiền mặt, số tiền, ngày, ghi chú, **chứng từ**, **bộ đếm tháng (số tiền + số lần)** | `Advance` (+ `CashEntry` sinh ra) | `advance-service` · Trang *Tạm ứng* | **H3** |
| **D** Mỗi lần THU | Thu của KH/đối tác nào, ngày, số tiền, tùy chọn | `CashEntry(kind=THU)` (+ link `Transaction` khi thu công nợ) | `cash-entry-service` · Trang *Phiếu thu* | **H2** |
| **E** Mỗi lần CHI | Người chi (chọn từ user NV), số tiền, danh mục chi, ngày, CK/tiền mặt | `CashEntry(kind=CHI)` | `cash-entry-service` · Trang *Phiếu chi* | **H2** |
| **F** Lọc báo cáo thu-chi từ ngày → ngày | Báo cáo dòng tiền theo khoảng ngày | (đọc `CashEntry`) | `cashflow-report` · Trang *Báo cáo thu-chi* | **H2**(cơ bản)→**H6**(đầy đủ) |
| **G** Cọc máy | KH/đại lý cọc, ngày, số lượng, chủng loại, đơn vị tính, số tiền | `DeviceDeposit` (+ `CashEntry` THU) | `deposit-service` · Trang *Cọc máy / Hoàn cọc* | **H4** |
| **H** Hoàn cọc | **Xác nhận đã thu hồi máy** (nối giao/thu máy POS = `AssetEvent`), số tiền hoàn, ngày, ai nhận/ai chuyển, chứng từ | `DepositRefund` (+ `CashEntry` CHI) | `deposit-service` | **H4** |
| **I** Thống kê máy cọc | Số máy **đã cọc / chưa cọc / đã hoàn cọc** — tường minh trên UI | (dẫn xuất từ `DeviceDeposit` × `PosDevice`/`PosIntake`) | StatBar trên Trang *Cọc máy* + Dashboard | **H4** |
| **J** Quỹ | Ai giữ quỹ (user), giữ bao nhiêu, thống kê tường minh | `Fund` | `fund-service` · Trang *Quỹ* | **H1**(tạo quỹ)→**H2**(số dư)→**H6**(đối soát) |
| **K** Chi lương | Chi cho NV nào, bao nhiêu, tháng nào, ngày, ai chi, **đã chi / chưa chi** | `SalaryPayment` (+ `CashEntry` CHI khi chi) | `salary-service` · Trang *Chi lương* | **H5** |
| **+LN** Lợi nhuận (LEAD 10/7) | **ACCRUAL (Q-A):** `Lợi nhuận tháng = Σ chênh lệch GD (Transaction theo txnDate) − Σ phiếu chi (CashEntry CHI)`, hiển thị Dashboard, so tháng trước | (đọc `Transaction` + `CashEntry CHI`) | mở rộng `dashboard-service` | **H6** (MVP có thể ở H2) |
| **+CL** Phân loại chất lượng công nợ (LEAD 10/7) | 3 mức Dễ/Khó/Không thu hồi, gắn công nợ, audit + lịch sử, lọc + Dashboard cảnh báo đỏ | `Transaction.debtQuality` (mở rộng) + `DebtQualityLog` | mở rộng `transaction-service` + `DebtPage` | **H2b** |

---

## 1. Quy ước NỀN (bám code hiện tại — CHỐNG bug)

| Quy ước | Giá trị THẬT trong code | Ghi chú thiết kế |
|---|---|---|
| **Tiền (số tiền VND)** | `Transaction.amount:Int`, `revenuePartner:Int` = **VND nguyên, KHÔNG ×1000** (`parseAmount` bắt integer ≥0) | ⚠️ **Đính chính brief:** brief nói "tiền ×1000 milli" — SAI so với code. Chỉ **phần trăm phí** mới ×1000 (`phiMua:Int //×1000`). → **`CashEntry.amount` lưu VND nguyên** cho nhất quán. Nếu lưu ×1000 sẽ lệch toàn bộ tổng với Transaction. (Điểm kiểm chứng bắt buộc — xem §6 rủi ro R3.) |
| **Phần trăm** | `Int ×1000` (3 số thập phân, không float) | Module thu-chi hầu như không dùng %, trừ nếu sau này có phí. |
| **Ngày** | `DateTime @db.Timestamptz(3)`; UI dùng `fmtDate` (dd/mm/yyyy, local) | Nhập `date` → `new Date(v+'T00:00:00')` (local, bài học **B16**). Lọc khoảng: `gte from 00:00`, `lte to 23:59:59`. |
| **Soft-delete** | `deletedAt/deletedBy` mọi bảng nghiệp vụ | Danh mục đang dùng KHÔNG xóa cứng (R4 §6). |
| **Truy vết** | `createdBy/updatedBy` + `createdAt/updatedAt` | Bắt buộc mọi bảng mới. |
| **Sinh mã** | `nextCode(prefix, txClient)` atomic qua `CodeCounter` | Prefix mới: `PT`(phiếu thu) `PC`(phiếu chi) `TU`(tạm ứng) `CM`(cọc máy) `HC`(hoàn cọc) `CL`(chi lương) `Q`(quỹ). Mã sinh **trong `$transaction`** cùng lúc create (chống race, bài học §D). |
| **Kết quả service** | `MutationResult { ok, error?, message?, id? }` message tiếng Việt cụ thể (R_UX_WARN) | Tái dùng nguyên mẫu transaction-service. |
| **Guard/Audit** | `requirePermission(CODE,{action,targetType})` + `writeAudit` — **mọi nhánh từ chối vẫn audit** | Xóa/hủy cần `verifyActorPassword` (như `deleteTransactions`). |
| **Chống race chuyển trạng thái** | conditional `updateMany({where:{...status:'X'}})` trong `$transaction`, `count===0`→lỗi | Bắt buộc cho POST/HỦY/HOÀN/settle (mẫu approval-service). |

---

## 2. MÔ HÌNH DỮ LIỆU (đề xuất Prisma — CHƯA áp)

### 2.1 `CashCategory` — Danh mục thu/chi (A + B)
```prisma
model CashCategory {
  id           Int       @id @default(autoincrement())
  kind         String    // THU | CHI
  name         String    // "Công nợ khách hàng", "Chi lương", "Doanh thu bán máy POS"...
  unit         String?   // đơn vị tính (mục A: "đồng", "máy", "tháng"...)
  periodType   String?   // NONE | MONTH | DATE_RANGE — kỳ áp dụng (mục A "tháng nào / từ ngày → ngày")
  sourceKind   String    @default("MANUAL") // MANUAL | DEBT_CUSTOMER | DEBT_PARTNER | SALE_POS | SALE_TID | ADVANCE | DEPOSIT | REFUND | SALARY
  isSystem     Boolean   @default(false)    // danh mục hệ thống (seed) — không cho xóa
  active       Boolean   @default(true)
  createdBy    Int?      @map("created_by")
  createdAt    DateTime  @default(now())
  updatedBy    Int?      @map("updated_by")
  updatedAt    DateTime  @updatedAt
  deletedAt    DateTime? @map("deleted_at")
  deletedBy    Int?      @map("deleted_by")
  @@map("cash_categories")
}
```
- `sourceKind` là **cầu nối chống đếm trùng**: category thu **DEBT_CUSTOMER/DEBT_PARTNER** buộc phiếu thu phải chọn đối tượng + (tùy chọn) các `Transaction` để tất toán; **SALE_POS/SALE_TID** = bán thiết bị (KHÔNG nằm trong Transaction — Transaction chỉ là chênh phí quẹt thẻ, xem §3).
- Seed sẵn các danh mục mục A nêu (đánh `isSystem=true`).

### 2.2 `Fund` — Quỹ (J)
```prisma
model Fund {
  id             Int       @id @default(autoincrement())
  code           String    @unique // Q01...
  name           String    // "Quỹ tiền mặt VP", "TK VCB 199..."
  type           String    // CASH | BANK | EWALLET
  keeperUserId   Int?      @map("keeper_user_id") // ai giữ quỹ (mục J)
  openingBalance Int       @default(0) @map("opening_balance") // VND
  active         Boolean   @default(true)
  note           String?
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@map("funds")
}
```
- **Số dư KHÔNG lưu cứng** — tính running: `currentBalance = openingBalance + Σ(CashEntry POSTED THU) − Σ(CashEntry POSTED CHI)` theo `fundId` (thị trường #5 Sapo). Tránh drift.

### 2.3 `CashEntry` — Phiếu thu/chi (chứng từ nguyên thủy — D + E)
```prisma
model CashEntry {
  id           Int       @id @default(autoincrement())
  code         String?   @unique // PT##### / PC#####
  kind         String    // THU | CHI
  categoryId   Int       @map("category_id")
  fundId       Int       @map("fund_id")        // quỹ tiền vào/ra (mục J liên thông)
  amount       Int                              // VND nguyên, > 0
  method       String    // CK | CASH           // hình thức (mục D/E)
  entryDate    DateTime  @map("entry_date")     // ngày thu/chi (local)
  // Đối tượng (một trong các chiều, tùy danh mục):
  customerId   Int?      @map("customer_id")    // KH (mục D)
  partnerId    Int?      @map("partner_id")     // đối tác (mục D)
  payerUserId  Int?      @map("payer_user_id")  // NGƯỜI CHI — bắt buộc khi kind=CHI (mục E)
  receiverUserId Int?    @map("receiver_user_id")// người nhận (thu hộ / hoàn cọc)
  // Chứng từ đính kèm (theo docs/FILE_UPLOAD_CONVENTION.md: path + tên gốc ngoài DB)
  docPath      String?   @map("doc_path")
  docName      String?   @map("doc_name")
  // Back-reference tới chứng từ nghiệp vụ sinh ra phiếu này (chống đếm trùng + truy vết):
  sourceType   String?   @map("source_type")    // ADVANCE | DEVICE_DEPOSIT | DEPOSIT_REFUND | SALARY | FUND_TRANSFER | null(thủ công)
  sourceId     Int?      @map("source_id")
  note         String?
  status       String    @default("POSTED")     // DRAFT | POSTED | CANCELLED  (state machine ghi sổ #8)
  cancelReason String?   @map("cancel_reason")
  cancelledAt  DateTime? @map("cancelled_at")
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@index([fundId]) @@index([categoryId]) @@index([entryDate]) @@index([status])
  @@index([customerId]) @@index([partnerId])
  @@map("cash_entries")
}
```

### 2.4 `CashDebtSettlement` — nối phiếu thu công nợ ↔ Transaction (CHỐNG ĐẾM TRÙNG — cốt lõi)
```prisma
model CashDebtSettlement {
  id            Int      @id @default(autoincrement())
  cashEntryId   Int      @map("cash_entry_id")   // phiếu thu (kind=THU, category DEBT_*)
  transactionId Int      @map("transaction_id")  // GD được tất toán
  side          String   // PARTNER | SELL  (thu khoản nào của GD — CL_NCC hay CL_KH)
  amount        Int                              // VND áp vào GD này
  createdAt DateTime @default(now())
  @@index([cashEntryId]) @@index([transactionId])
  @@map("cash_debt_settlements")
}
```
- Cho phép **thu công nợ từng phần / gộp nhiều GD**. Khi phiếu thu POSTED: tổng `amount` áp ≤ **công nợ còn lại** của đối tượng; GD được tất toán đủ 2 khoản → set `Transaction.settled=true` (giữ cơ chế `settled` sẵn có, KHÔNG đổi ý nghĩa doanh thu).
- ⚠️ **Không nhân đôi số liệu:** doanh thu đã ghi ở `Transaction.revenueAmount`; phiếu thu công nợ chỉ **chuyển tiền từ trạng thái "phải thu" → "đã thu tiền mặt/CK vào quỹ"**, KHÔNG cộng lại vào doanh thu. Báo cáo doanh thu (RevenuePage) và báo cáo dòng tiền (Cashflow) là **2 lớp khác nhau** (accrual vs cash) — xem §5.

### 2.5 `Advance` — Tạm ứng (C)
```prisma
model Advance {
  id            Int      @id @default(autoincrement())
  code          String?  @unique // TU#####
  categoryId    Int?     @map("category_id")     // hạng mục tạm ứng (CashCategory kind=CHI, sourceKind=ADVANCE)
  payerUserId   Int      @map("payer_user_id")   // người chi ứng
  receiverUserId Int     @map("receiver_user_id")// người nhận tạm ứng
  method        String   // CK | CASH
  fundId        Int      @map("fund_id")
  amount        Int                              // VND
  advanceDate   DateTime @map("advance_date")
  settledAmount Int      @default(0) @map("settled_amount") // đã hoàn ứng bao nhiêu
  status        String   @default("OPEN")        // OPEN | PARTIAL | CLEARED | CANCELLED
  docPath String? ; docName String?
  note String?
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@index([receiverUserId]) @@index([advanceDate])
  @@map("advances")
}
```
- **Bộ đếm tháng (mục C):** dẫn xuất — `count(*)` (số lần) + `Σ amount` (số tiền) của `Advance` trong tháng lọc. Hiển thị StatBar.
- Hoàn ứng = 1 `CashEntry` THU liên kết (`sourceType=ADVANCE`), cộng `settledAmount`.

### 2.6 `DeviceDeposit` — Cọc máy (G) + `DepositRefund` — Hoàn cọc (H)
```prisma
model DeviceDeposit {
  id           Int      @id @default(autoincrement())
  code         String?  @unique // CM#####
  depositorType String  @map("depositor_type") // CUSTOMER | AGENT (mục G: khách cọc / chọn đại lý)
  customerId   Int?     @map("customer_id")
  agentId      Int?     @map("agent_id")
  posModelId   Int?     @map("pos_model_id")    // chủng loại máy (mục G)
  quantity     Int      @default(1)             // số lượng
  unit         String?                          // đơn vị tính
  amount       Int                              // số tiền cọc (VND) — mục G "cọc 5.000.000"
  depositDate  DateTime @map("deposit_date")
  method       String   // CK | CASH
  fundId       Int      @map("fund_id")
  refundedAmount Int    @default(0) @map("refunded_amount")
  status       String   @default("HELD")        // HELD | PARTIAL_REFUND | REFUNDED | CANCELLED
  docPath String? ; docName String?
  note String?
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@index([customerId]) @@index([agentId]) @@index([posModelId]) @@index([status])
  @@map("device_deposits")
}

model DepositRefund {
  id             Int      @id @default(autoincrement())
  code           String?  @unique // HC#####
  depositId      Int      @map("deposit_id")
  amount         Int                              // số tiền hoàn (mục H)
  refundDate     DateTime @map("refund_date")
  payerUserId    Int      @map("payer_user_id")   // ai CHUYỂN hoàn
  receiverUserId Int?     @map("receiver_user_id") // ai NHẬN hoàn (khách/đại lý — text hoặc user)
  method         String   // CK | CASH
  fundId         Int      @map("fund_id")
  // XÁC NHẬN THU HỒI MÁY (mục H) — nối nghiệp vụ giao/thu máy POS:
  deviceRecovered Boolean @default(false) @map("device_recovered")
  recoveredAssetEventId Int? @map("recovered_asset_event_id") // trỏ AssetEvent RECALL/thu hồi
  recoveredPosSerial String? @map("recovered_pos_serial")
  docPath String? ; docName String?
  note String?
  createdBy Int? ; createdAt DateTime @default(now())
  deletedAt DateTime? ; deletedBy Int?
  @@index([depositId])
  @@map("deposit_refunds")
}
```
- **Bất biến H:** `DepositRefund` chỉ POST được khi `deviceRecovered=true` **và** có `recoveredAssetEventId`/serial hợp lệ → chặn hoàn cọc khi máy chưa về (xem §4).
- **Thống kê mục I** (StatBar Trang Cọc máy + Dashboard):
  - *Số máy đã cọc* = `Σ quantity` của `DeviceDeposit` status ∈ {HELD, PARTIAL_REFUND}.
  - *Số máy đã hoàn cọc* = `Σ quantity` status=REFUNDED (hoặc Σ máy có `DepositRefund.deviceRecovered=true`).
  - *Số máy chưa cọc* = (tổng máy đang ở KH/đại lý — từ `PosDevice.status=DEPLOYED` / `PosIntake`) − số máy đã cọc. **Cần Mr.Long chốt mẫu số** (xem §7 Q6).

### 2.7 `SalaryPayment` — Chi lương (K)
```prisma
model SalaryPayment {
  id          Int      @id @default(autoincrement())
  code        String?  @unique // CL#####
  userId      Int      @map("user_id")        // chi cho NV nào (mục K)
  period      String                          // "YYYY-MM" — tháng lương
  amount      Int                              // VND
  status      String   @default("UNPAID")     // UNPAID | PAID (mục K "đã chi / chưa chi")
  paidByUserId Int?    @map("paid_by_user_id") // ai chi
  paidAt      DateTime? @map("paid_at")
  payDate     DateTime? @map("pay_date")       // ngày chi
  method      String?  // CK | CASH
  fundId      Int?     @map("fund_id")
  note String?
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@unique([userId, period])                   // 1 dòng lương / NV / tháng (enforce ở service với bản deletedAt)
  @@index([status]) @@index([period])
  @@map("salary_payments")
}
```
- Khi chuyển UNPAID→PAID: sinh `CashEntry` CHI (`sourceType=SALARY`), set `paidByUserId/paidAt/payDate`.

### 2.8 `DebtQualityLog` — Lịch sử đổi phân loại công nợ (LEAD 10/7)
Mở rộng `Transaction`: thêm cột `debtQuality String @default("EASY") // EASY | HARD | BAD` (+ index).
```prisma
model DebtQualityLog {
  id            Int      @id @default(autoincrement())
  transactionId Int      @map("transaction_id")
  fromQuality   String?  @map("from_quality")
  toQuality     String   @map("to_quality")
  reason        String?
  actorUserId   Int      @map("actor_user_id")
  createdAt     DateTime @default(now())
  @@index([transactionId])
  @@map("debt_quality_logs")
}
```
**Gắn ở đâu — phân tích:** gắn **mức từng khoản (Transaction)**, KHÔNG chỉ mức khách. Lý do: 1 khách có thể có món cũ khó thu + món mới dễ thu; chất lượng thay đổi theo từng lần quẹt/từng kỳ. → nguồn chuẩn = `Transaction.debtQuality`.
Có thể thêm `Customer.defaultDebtQuality` (tùy chọn, làm **giá trị mặc định** khi tạo GD mới) — nhưng con số thống kê luôn tính từ Transaction. (Đề xuất: H2b làm mức Transaction trước; default-per-customer để pha sau nếu Mr.Long cần.)

---

## 3. LIÊN THÔNG với dữ liệu ĐÃ CÓ (không dựng trùng)

| Đã có | Thu-chi NỐI vào thế nào |
|---|---|
| `Transaction` (doanh thu quẹt thẻ = CL_NCC + CL_KH; `settled` bool; `revenuePartner/Sell/Amount`) | **Công nợ = phần chưa `settled` của Transaction.** Phiếu thu danh mục DEBT_* **tất toán** GD qua `CashDebtSettlement` → set `settled=true`. KHÔNG tạo bảng công nợ mới. |
| `Customer` (KH##), `Partner`, `Agent` | Đối tượng của phiếu/cọc — chọn từ danh sách sẵn (như DebtPage). |
| `PosDevice`, `PosModel`, `PosIntake`, `AssetEvent`, `PosTidBinding` | Cọc/hoàn cọc trỏ `posModelId`; xác nhận thu hồi máy trỏ `AssetEvent` (RECALL). |
| `User` (NV##) | Người chi/nhận, người giữ quỹ, đối tượng chi lương. |
| `ApprovalRequest` (generic engine) | Tái dùng cho **duyệt hủy/duyệt chi** phiếu (entityType='CashEntry') — xem §7 Q1. |
| `Fund` ↔ `CashEntry` | Chuyển quỹ = **cặp** CashEntry (CHI quỹ A + THU quỹ B, `sourceType=FUND_TRANSFER`) — thị trường #7, KHÔNG tính vào tổng dòng tiền báo cáo. |
| `dashboard-service` | Mở rộng `DashboardStats` thêm khối Lợi nhuận + công nợ theo mức. |

**Bán máy POS/TID (danh mục SALE_POS/SALE_TID) ≠ Transaction:** Transaction là chênh phí **quẹt/rút thẻ**. Bán thiết bị vật lý là dòng tiền riêng → ghi thẳng `CashEntry` THU, KHÔNG đụng Transaction. Không có rủi ro trùng ở đây.

---

## 4. BẤT BIẾN NGHIỆP VỤ (invariants — chuyển thành selftest)

1. **Quỹ cân:** với mọi quỹ, `openingBalance + Σ THU_POSTED − Σ CHI_POSTED = currentBalance` (tính lại từ DB, không đọc số cứng). Selftest tạo N phiếu → assert.
2. **Thu công nợ ≤ công nợ còn lại:** `Σ CashDebtSettlement.amount (đối tượng) ≤ debtTotal(đối tượng)`. Vượt → `error:'DEBT_OVERPAY'`, message rõ.
3. **Phiếu chi bắt buộc `payerUserId`** (mục E). Thiếu → VALIDATION.
4. **Số tiền > 0 nguyên**, VND (không âm, không thập phân, không ×1000). Tràn: chặn > `Number.MAX_SAFE_INTEGER` (thực tế đặt trần ví dụ 1e15).
5. **Hoàn cọc ≤ tiền đã cọc:** `Σ DepositRefund.amount ≤ DeviceDeposit.amount`. Vượt → `REFUND_OVERFLOW`.
6. **Hoàn cọc cần xác nhận thu hồi máy:** POST `DepositRefund` yêu cầu `deviceRecovered=true` + AssetEvent/serial hợp lệ. Thiếu → `DEVICE_NOT_RECOVERED`.
7. **Tạm ứng: bộ đếm tháng** = số lần + tổng tiền trong tháng khớp dữ liệu.
8. **Chi lương 1 dòng/NV/tháng** (`@@unique(userId,period)` + xử lý bản soft-deleted như bài học B05/DUPLICATE_TRASH).
9. **Chuyển trạng thái nguyên tử** (POST/HỦY/settle): conditional `updateMany` trong `$transaction`, thua → lỗi, không đếm trùng.
10. **Ngày local:** phiếu ngày 2026-07-01 phải rơi đúng kỳ tháng 7 khi lọc/tổng (bài học B16).
11. **BAD không tự trừ doanh thu đã ghi** (mặc định) — chỉ gắn cờ; ảnh hưởng lợi nhuận **chỉ khi Mr.Long chốt ghi giảm** (§7 Q4).

---

## 5. LỢI NHUẬN Ở DASHBOARD (bổ sung LEAD 10/7) — phản biện chống đếm trùng

**Công thức:** `Lợi nhuận(tháng) = Tổng THU(tháng) − Tổng CHI(tháng)`.

**Định nghĩa "Tổng THU" — phải rõ để KHÔNG trùng doanh thu Transaction:**
- **Cash-basis (ĐỀ XUẤT):** Tổng THU = `Σ CashEntry(kind=THU, status=POSTED)` trong tháng, **trừ** phiếu nội bộ `sourceType=FUND_TRANSFER` (chuyển quỹ không phải thu thật). Tổng CHI = `Σ CashEntry(kind=CHI, POSTED)` trừ FUND_TRANSFER. → Lợi nhuận = **dòng tiền ròng thực thu − thực chi**.
- **Accrual (doanh thu ghi nhận):** `Transaction.revenueAmount` theo `txnDate` — đây là **doanh thu chênh phí ĐÃ GHI dù chưa thu tiền**. RevenuePage đã hiển thị lớp này.

⚠️ **Hai lớp KHÁC nhau, KHÔNG cộng chung.** Nếu Tổng THU vừa lấy CashEntry (đã thu công nợ) **vừa** cộng `Transaction.revenueAmount` (doanh thu ghi nhận) → **đếm trùng đúng khoản công nợ đó 2 lần**. Vì vậy Dashboard Lợi nhuận **chỉ dùng CashEntry (cash-basis)**. Doanh thu accrual để ở khối riêng "Doanh thu ghi nhận" (đã có), không trộn vào ô Lợi nhuận.

**Hiển thị Dashboard (KpiCard sẵn có, mở rộng `DashboardStats`):**
- KpiCard *Tổng thu tháng* · *Tổng chi tháng* · *Lợi nhuận (thu−chi)* (xanh nếu ≥0, đỏ nếu <0) · *So tháng trước* (Δ%).
- `dashboard-service.getStats` thêm `cashflow: { month, totalIn, totalOut, profit, prevProfit }` (đọc CashEntry, gộp theo `entryDate` local). Trả cả khi 0 (empty-state, như pattern hiện tại).

**→ Câu hỏi chốt (§7 Q3):** Lợi nhuận lấy **cash thực thu-thực chi** (đề xuất) hay **doanh thu ghi nhận − chi**? Hai con số sẽ lệch khi còn công nợ chưa thu.

---

## 5b. PHÂN LOẠI CHẤT LƯỢNG CÔNG NỢ (bổ sung LEAD 10/7)

- **3 mức:** `EASY` Dễ thu hồi · `HARD` Khó thu hồi · `BAD` Không có khả năng thu hồi.
- **Gắn:** cột `Transaction.debtQuality` (mức từng khoản — phân tích §2.8). Mặc định `EASY` khi tạo GD.
- **Ai đổi:** quyền mới `DEBT_CLASSIFY`. Đổi phải ghi `DebtQualityLog` (from→to + reason + actor) + `writeAudit`. Chỉ đổi được GD **chưa settled** (đã thu rồi thì không còn là công nợ — chặn hoặc chỉ cho xem).
- **Hiển thị DebtPage:** StatBar 3 ô đếm theo mức (số GD + tổng tiền mỗi mức); FilterBar thêm chọn mức; BAD tô **đỏ** (StatusPill `bg-danger/10`).
- **Dashboard:** khối *Công nợ theo chất lượng* — tổng tiền EASY/HARD/BAD; **BAD = cảnh báo đỏ** (gợi ý trích lập/ghi giảm).
- **Ảnh hưởng lợi nhuận (phản biện):** mặc định BAD **chỉ gắn cờ cảnh báo, KHÔNG tự trừ lợi nhuận** (lợi nhuận cash-basis §5 không dựa doanh thu accrual nên BAD vốn không nằm trong đó). Nếu Mr.Long muốn "ghi giảm/trích lập dự phòng" → cần chứng từ CHI riêng (danh mục "Chi phí nợ xấu") hoặc bút toán ghi giảm doanh thu accrual — **cần chốt** (§7 Q4).

---

## 6. SERVICE · IPC · UI · PHÂN QUYỀN

### 6.1 Service + method (mẫu transaction-service; mọi method guard + audit)
| Service | Method chính |
|---|---|
| `cash-category-service` | `list(filter)` `create` `update` `remove(pwd)` (chặn xóa nếu đang dùng → `IN_USE`) |
| `fund-service` | `list` `create` `update` `remove` `balance(fundId, dateTo?)` (running) |
| `cash-entry-service` | `list(filter)` `summary(filter)` `create(input)` `cancel(id, reason)` `remove(ids,pwd)`; thu công nợ: `createDebtReceipt(input, settlements[])` |
| `advance-service` | `list` `create` `clear(id, cashEntry)` (hoàn ứng) `cancel`; `monthlyCounter(filter)` |
| `deposit-service` | `list` `create` `refund(input)` (guard thu hồi máy) `cancel`; `deviceStats(filter)` (mục I) |
| `salary-service` | `list(period)` `create/upsert` `pay(id, input)` `unpay`(sửa)` cancel` |
| `debt-quality` (trong transaction-service) | `classify(transactionId, quality, reason)` `qualityHistory(transactionId)` `debtByQuality(filter)` |
| `cashflow-report` | `report(filter)` (nhóm theo ngày/danh mục/quỹ) `profitByMonth()` (Dashboard) |

Kết quả `MutationResult` message VN cụ thể (R_UX_WARN): `DEBT_OVERPAY`→"Số thu vượt công nợ còn lại (còn X đ).", `REFUND_OVERFLOW`→"Hoàn cọc vượt số đã cọc.", `DEVICE_NOT_RECOVERED`→"Chưa xác nhận thu hồi máy — không hoàn cọc được.", `IN_USE`→"Danh mục đang được dùng ở N phiếu, không xóa được." …

### 6.2 IPC (mẫu `ipcMain.handle('domain:action', …)` trong ipc.ts)
`cashCategory:list|create|update|remove` · `fund:list|create|update|remove|balance` · `cashEntry:list|summary|create|createDebtReceipt|cancel|remove` · `advance:list|create|clear|cancel|counter` · `deposit:list|create|refund|cancel|stats` · `salary:list|upsert|pay|unpay|cancel` · `debt:classify|qualityHistory|byQuality` · `cashflow:report|profitByMonth`.
→ Khai đủ DTO/method trong **`preload/index.d.ts`** (FILE BẢO VỆ — chỉ CMD_BUILD chỉnh, kèm review).

### 6.3 Trang UI (tái dùng KpiCard/StatBar·StatusPill·FilterBar·Field·Button·ConfirmDialog·toast·exportCsv·`fmtDate`·`money()`)
1. **Cấu hình danh mục thu-chi** (H1) — 2 tab THU/CHI, cột đơn vị + kỳ.
2. **Quỹ** (H1/H2) — danh sách quỹ + người giữ + số dư running; StatBar tổng quỹ.
3. **Phiếu thu** (H2) — form + list realtime; thu công nợ chọn đối tượng → hiện GD chưa settled để tất toán.
4. **Phiếu chi** (H2) — form (người chi bắt buộc) + list.
5. **Báo cáo thu-chi** (H2→H6) — FilterBar **từ ngày→đến ngày** (mục F) + danh mục/quỹ/đối tượng; bảng + tổng + Xuất Excel.
6. **Tạm ứng** (H3) — list + StatBar bộ đếm tháng (số lần · tổng tiền).
7. **Cọc máy / Hoàn cọc** (H4) — 2 khối; StatBar mục I (đã cọc/chưa cọc/hoàn cọc).
8. **Chi lương** (H5) — lọc theo tháng; StatusPill Đã chi/Chưa chi; nút "Đánh dấu đã chi".
9. **Dashboard** (H6) — thêm KpiCard Lợi nhuận + khối công nợ theo chất lượng.
*Mỗi trang có bộ đếm trực quan (StatBar/KpiCard) — yêu cầu chung Mr.Long.*

### 6.4 Phân quyền (thêm vào `permissions.ts`, group "Thu – Chi")
| Code | Ý nghĩa | Gợi ý gán |
|---|---|---|
| `CASHFLOW_VIEW` | Xem thu-chi/quỹ/báo cáo | ADMIN, MANAGER, ACCOUNTANT |
| `CASHFLOW_CONFIG` | Cấu hình danh mục + quỹ | ADMIN, ACCOUNTANT |
| `CASH_RECEIPT_CREATE` | Lập phiếu thu | ADMIN, MANAGER, ACCOUNTANT |
| `CASH_PAYMENT_CREATE` | Lập phiếu chi | ADMIN, ACCOUNTANT |
| `CASH_ENTRY_CANCEL` | Hủy/ xóa phiếu | ADMIN, MANAGER |
| `CASH_ENTRY_APPROVE` | Duyệt phiếu (nếu bật, §7 Q1) | ADMIN |
| `ADVANCE_MANAGE` | Tạm ứng | ADMIN, MANAGER, ACCOUNTANT |
| `DEPOSIT_MANAGE` | Cọc/hoàn cọc | ADMIN, MANAGER |
| `SALARY_MANAGE` | Chi lương | ADMIN |
| `DEBT_CLASSIFY` | Đổi phân loại chất lượng công nợ | ADMIN, MANAGER |
Kiểm quyền **bằng code**, không tên role. Cập nhật `DEFAULT_ROLE_PERMISSIONS` + xử lý bug "quyền mới không gán role cũ" (memory 9/7): seed bổ sung khi migrate.

---

## 7. KẾ HOẠCH BUILD THEO PHA (tuần tự, mỗi pha 1 gate)

| Pha | Nội dung | Bảng mới | Gate riêng |
|---|---|---|---|
| **H1** | Nền: schema + `CashCategory` (danh mục THU/CHI) + `Fund` (quỹ) + phân quyền + seed danh mục hệ thống | CashCategory, Fund | typecheck0/build0 · vitest · selftest: CRUD danh mục, chặn xóa danh mục đang dùng, tạo quỹ |
| **H2** | Phiếu thu/chi (`CashEntry`) + số dư quỹ running + thu công nợ nối `Transaction` + báo cáo lọc ngày (cơ bản) + KpiCard lợi nhuận MVP | CashEntry, CashDebtSettlement | selftest: quỹ cân (I#1), thu công nợ ≤ nợ còn lại (I#2), người chi bắt buộc (I#3), tiền>0 không tràn (I#4), ngày local (I#10), chuyển quỹ không double-count |
| **H2b** | Phân loại chất lượng công nợ (Transaction.debtQuality + log) + DebtPage StatBar/lọc 3 mức | DebtQualityLog (+cột Transaction) | selftest: đổi mức ghi log+audit, chặn đổi GD đã settled, tổng theo mức khớp |
| **H3** | Tạm ứng + hoàn ứng + bộ đếm tháng | Advance | selftest: bộ đếm tháng đúng (I#7), hoàn ứng ≤ tạm ứng, sinh CashEntry liên kết |
| **H4** | Cọc máy + hoàn cọc + xác nhận thu hồi (nối AssetEvent) + thống kê mục I | DeviceDeposit, DepositRefund | selftest: hoàn cọc ≤ đã cọc (I#5), chặn hoàn khi máy chưa về (I#6), thống kê đã/chưa/hoàn cọc |
| **H5** | Chi lương + trạng thái đã/chưa chi | SalaryPayment | selftest: 1 dòng/NV/tháng (I#8), PAID sinh CashEntry, quỹ giảm đúng |
| **H6** | Báo cáo thu-chi đầy đủ + đối soát quỹ + Dashboard Lợi nhuận theo tháng + công nợ theo chất lượng | — | selftest: đối soát quỹ tổng khớp, profit tháng = thu−chi, so tháng trước |

Mỗi pha theo **R_PROCESS_FEATURE_GATE**: build UI → CMD_AUDIT mở app screenshot/click → commit → pha kế. **Freeze + git tag** trước sang pha sau (WORKFLOW TỐI THƯỢNG). Không Build→Build→Build.

---

## 8. RỦI RO / PHẢN BIỆN (≥5 điểm dễ sai + cách chặn)

| # | Rủi ro | Hậu quả | Cách chặn |
|---|---|---|---|
| R1 | **Đếm trùng doanh thu** (cộng cả CashEntry thu công nợ lẫn Transaction.revenueAmount) | Lợi nhuận/doanh thu phồng gấp đôi | Tách 2 lớp cash vs accrual (§5); Lợi nhuận Dashboard **chỉ** CashEntry; thu công nợ chỉ đổi `settled`, không cộng doanh thu; loại FUND_TRANSFER khỏi tổng |
| R2 | **Cọc âm / hoàn cọc vượt** | Quỹ sai, cọc âm | Invariant I#5 `Σ refund ≤ deposit.amount`; conditional updateMany; amount>0 |
| R3 | **Sai đơn vị tiền (×1000)** | Toàn bộ tổng lệch 1000 lần so Transaction | §1: CashEntry.amount = **VND nguyên** như Transaction; selftest so tổng CashEntry với money hiển thị; **đính chính brief** |
| R4 | **Xóa mềm danh mục đang dùng** | Phiếu mồ côi, báo cáo lỗi | `remove` chặn nếu có CashEntry tham chiếu (`IN_USE`); chỉ cho `active=false`; join theo id vẫn hiển thị được |
| R5 | **Tiền âm / thập phân / tràn** | Crash / sai tổng | `parseAmount` integer>0, trần an toàn; type Int |
| R6 | **Đối soát quỹ lệch** (đọc số dư cứng bị drift) | Số dư sai theo thời gian | KHÔNG lưu số dư cứng — luôn tính running từ CashEntry POSTED (I#1) |
| R7 | **Race sinh mã phiếu / duyệt 2 lần** | Trùng mã, hủy đôi | `nextCode` trong `$transaction` cùng create; conditional transition (mẫu approval-service) |
| R8 | **Hoàn cọc khi máy chưa thu hồi** | Mất tiền + mất máy | I#6 bắt buộc `deviceRecovered` + AssetEvent hợp lệ mới POST |
| R9 | **Ngày lệch kỳ (UTC vs local)** | Phiếu nhảy tháng, lợi nhuận sai kỳ | Quy ước local B16; lọc `from 00:00 / to 23:59:59` local |
| R10 | **BAD tự trừ lợi nhuận ngoài ý muốn** | Số liệu sai lệch quyết định | Mặc định BAD chỉ gắn cờ; ghi giảm chỉ khi Mr.Long chốt (Q4) qua chứng từ CHI riêng |
| R11 | **Quyền mới không gán role cũ** (bug 9/7) | ADMIN kẹt quyền, menu ẩn | Migrate seed cấp quyền thu-chi cho role phù hợp + test "DB tiến hóa" |

---

## 9. CÂU HỎI CẦN Mr.Long CHỐT

1. **Duyệt phiếu chi?** Phiếu chi (đặc biệt trên 1 ngưỡng, vd ≥ X đ) có cần **duyệt như hủy bill** không (tái dùng ApprovalRequest), hay ghi thẳng POSTED + hủy mới cần duyệt? (Đề xuất: ghi thẳng; hủy cần duyệt + mật khẩu như xóa GD.)
2. **Đối soát ngân hàng:** có tích hợp thẳng dữ liệu bill/sao kê từ `globeway-quanlytaikhoan` (draft→post) ngay pha này, hay để pha sau chỉ nhập tay/ import Excel?
3. **Lợi nhuận Dashboard:** lấy **cash thực thu − thực chi** (đề xuất) hay **doanh thu ghi nhận − chi**? (Hai số lệch khi còn công nợ chưa thu.)
4. **Nợ "không có khả năng thu hồi" (BAD):** chỉ **gắn cờ cảnh báo** (đề xuất) hay **ghi giảm/trích lập** trừ vào lợi nhuận? Nếu ghi giảm thì theo cash hay theo accrual?
5. **Phân loại công nợ gắn mức nào:** từng khoản `Transaction` (đề xuất) hay cả khách? Có cần default-per-customer không?
6. **Thống kê "số máy chưa cọc" (mục I):** mẫu số là máy đang triển khai ở KH/đại lý (`PosDevice.status=DEPLOYED`) hay toàn bộ máy đã bán/giao? Định nghĩa "chưa cọc" chuẩn?
7. **Người nhận hoàn cọc / người nhận tạm ứng** là **User nội bộ** hay có thể là khách/đại lý (text tự do)? (Ảnh hưởng kiểu trường receiver.)
8. **Prefix mã** PT/PC/TU/CM/HC/CL/Q có đúng ý Mr.Long không?

---

## 10. TÓM TẮT
- **Mô hình chính:** `CashEntry` (phiếu thu/chi = chứng từ nguyên thủy) là trục; `Fund` cân bằng bằng running-balance; `Advance`/`DeviceDeposit`/`DepositRefund`/`SalaryPayment` là chứng từ nghiệp vụ **sinh CashEntry liên kết** (không đếm trùng); công nợ **nối `Transaction` sẵn có** qua `CashDebtSettlement`; phân loại chất lượng công nợ ở `Transaction.debtQuality` + `DebtQualityLog`; Lợi nhuận Dashboard = cash-basis từ CashEntry.
- **7 pha** (H1→H6, có H2b), mỗi pha 1 gate + selftest nghiệp vụ, tuần tự freeze/tag.
- **Rủi ro top:** đếm trùng doanh thu (R1), sai đơn vị ×1000 (R3, đã đính chính brief), đối soát quỹ drift (R6), hoàn cọc khi máy chưa về (R8), quyền mới không gán role cũ (R11).
