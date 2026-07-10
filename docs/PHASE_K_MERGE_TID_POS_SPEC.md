# PHASE K — Hợp nhất module TID + module POS (đề xuất thiết kế)

> Trạng thái: **ĐỀ XUẤT (Designer)** — chờ Mr.Long chốt. CMD kiến trúc chỉ ĐỌC code + GHI file này. KHÔNG sửa code/schema/commit.
> Repo canonical: `D:\TT HKD AI\tools\quan-ly-glb` — verify commit `fa2c002`.
> Ngày: 11/7. Nguồn phân tích: đọc thực `schema.prisma`, `tid-service.ts`, `tid-config-service.ts`, `pos-service.ts`, `pos-supply-service.ts`, `Dashboard.tsx`, `TidPage.tsx`, `PosSupplyPage.tsx`, `asset.rules.ts`, `permissions.ts`.

---

## 0. TÓM TẮT ĐIỀU HÀNH

Mr.Long muốn 2 việc:
1. **TID:** gộp "Quản Lý TID" (`TidPage`, menu `tid`, perm `TID_*`) + "Cấu hình TID" (`TidConfigPage`, menu `tidcfg`, perm `CONFIG_TID_*`) → **1 module TID duy nhất**.
2. **POS:** gộp "Quản lý máy POS" (`PosPage`, menu `pos`, perm `POS_*`) + "Cấu hình máy POS / Nhập kho" (`PosSupplyPage`, menu `possupply`, perm `CONFIG_POS_SUPPLY_*`) → **1 module POS duy nhất**.

**Phát hiện then chốt (khác nhau giữa 2 cụm):**

| Cụm | Số bảng dữ liệu thực | Bản chất vấn đề |
|-----|----------------------|------------------|
| **TID** | **1 bảng** (`tids`) đã gộp sẵn (G-CFG.6 Cách 1) | KHÔNG phải 2-bản-ghi. Là **2 service + 2 UI + 2 đường tạo** cùng ghi vào 1 bảng → chủ yếu là **hợp nhất UI + hợp nhất luồng tạo**, không cần migrate dữ liệu lớn. |
| **POS** | **2 bảng** (`pos_devices` + `pos_intakes`) **RỜI NHAU**, cùng khóa `serial`, KHÔNG có liên kết | Đây MỚI là **2-bản-ghi thật**. `createPosIntake` KHÔNG tạo `PosDevice` → nhập kho xong không thấy ở "Quản lý máy POS" (desync #22). Cần **migration + backfill**. |

---

## 1. HIỆN TRẠNG CHI TIẾT

### 1.1 TID — đã là 1 bảng, 2 mặt

Bảng `tids` (model `Tid`) đã chứa CẢ hai nhóm field:

- **Nhóm vận hành** (do `tid-service.ts`, perm `TID_VIEW/TID_MANAGE`): `tid`, `mid`, `bank` (text legacy), `status` (`UNASSIGNED|ACTIVE|DEAD|CLOSED|RECALLED`), `posSerial`, `customerId`, `agentId`, `openedAt`, `deliveredAt`, `closedAt`.
- **Nhóm cấu hình** (do `tid-config-service.ts`, perm `CONFIG_TID_VIEW/CONFIG_TID_MANAGE`): `bankId` (FK Bank, thay `bank` text), `partnerId` (FK Partner → tra biểu phí), `hkdName`, `receiveAccountId`, `issuedAt`, `configStatusId` (FK `TidConfigStatus`), `dossierSourceId`, `note`, `deletedAt`, `createdBy/updatedBy`.

**Hai đường TẠO khác nhau, cùng bảng, cùng khóa `tid` (unique):**

| | `createTid` (tid-service) | `createConfigTid` (tid-config-service) |
|--|---------------------------|----------------------------------------|
| Perm | `TID_MANAGE` | `CONFIG_TID_MANAGE` |
| Set field | `tid`, `mid`, `bank`(text), `status=UNASSIGNED`, `openedAt` | `tid`, `status=UNASSIGNED`, `bankId`, `partnerId`, `hkdName`, `receiveAccountId`, `issuedAt`, `configStatusId`, `dossierSourceId`, `note`, `createdBy` |
| KHÔNG set | bankId/partner/hkd/... | mid/bank(text)/openedAt |
| Audit | `TID_CREATED` | `TID_CONFIG_CREATED` |

→ TID tạo ở form nào cũng xuất hiện ở list bên kia (cùng bảng), nhưng **thiếu field của phía kia**. Trùng field: `bank`(text, legacy) ↔ `bankId`(FK). Không có migration cần thiết — chỉ cần **thống nhất 1 form tạo đầy đủ + 1 list**.

**Vòng đời `tids.status`** (từ `asset.rules.ts`):
- `assign`: `UNASSIGNED → ACTIVE` (gán POS + khách).
- `markDead`: `ACTIVE → DEAD` (khi thay TID).
- `close`: `ACTIVE → CLOSED`.
- `recall`: `ACTIVE|DEAD|CLOSED → RECALLED` (+ unbind POS, clear `currentTid`).
- `activateReplacement`: `UNASSIGNED → ACTIVE` (TID mới thay TID cũ).
- **`deliveredAt`**: KHÔNG phải status — là **timestamp phụ** đặt trên nền `ACTIVE` (markTidDelivered). "Đã giao khách" = `ACTIVE && deliveredAt != null`; "đã gán nhưng chưa giao" = `ACTIVE && deliveredAt == null`.

### 1.2 POS — 2 bảng rời (vấn đề thật)

| Bảng | Model | Do service | Khóa | Field chính |
|------|-------|-----------|------|-------------|
| `pos_devices` | `PosDevice` | `pos-service.ts` (`POS_*`) | `serial` unique | `serial`, `model`(text), `bank`(text), `status` (`IN_STOCK|DEPLOYED|IN_REPAIR|DAMAGED|RETIRED`), `currentAgentId`, `currentCustomerId`, `currentTid`, `warehouseLoc`, `note`. **KHÔNG có** `deletedAt`/`createdBy`. |
| `pos_intakes` | `PosIntake` | `pos-supply-service.ts` (`CONFIG_POS_SUPPLY_*`) | `serial` unique | `serial`, `posModelId`(FK PosModel), `intakeStatusId`(FK), `supplierId`(FK Supplier), `importPrice`, `importedAt`, `note`, `deletedAt`, `createdBy/updatedBy`. **KHÔNG có** status vận hành / currentTid / customer. |

**Quan hệ:** KHÔNG có FK, KHÔNG có backfill. Chỉ trùng ý niệm qua `serial`.
- `createPos` (POS_MANAGE): tạo `PosDevice` IN_STOCK + `AssetEvent(STOCK_IN)`.
- `createPosIntake` (CONFIG_POS_SUPPLY_MANAGE): tạo `PosIntake` — **KHÔNG** tạo `PosDevice`, **KHÔNG** ghi `AssetEvent`.

**Hệ quả (bug #22 desync):**
1. Nhập kho (`createPosIntake`) xong → máy KHÔNG xuất hiện ở "Quản Lý Máy POS" (`listPosDevices` chỉ đọc `pos_devices`).
2. `assignTid` tra `db.posDevice.findUnique({ serial })` → máy chỉ mới nhập kho (chỉ có ở `pos_intakes`) **không gán TID được**.
3. Chủng loại/NCC/giá nhập (ở `pos_intakes`) không hiển thị được cạnh trạng thái vận hành (ở `pos_devices`).
4. `model`/`bank` ở `PosDevice` là text tự do, tách rời `PosModel` (master) → dữ liệu không nhất quán.

Bảng phụ giữ nguyên: `AssetEvent` (nhật ký bất biến), `PosTidBinding` (lịch sử bind POS↔TID), master `PosModel`/`Supplier`/`PosIntakeStatus`.

---

## 2. ĐỀ XUẤT — CỤM POS

### 2.1 Mô hình dữ liệu hợp nhất

**Nguyên tắc: `PosDevice` = NGUỒN SỰ THẬT DUY NHẤT của 1 máy. `PosIntake` giáng cấp thành LỊCH SỬ NHẬP (không còn là "nơi tạo máy").**

Bổ sung field vào `PosDevice` (di trú các field cung ứng từ `PosIntake` sang bản ghi máy):

```
model PosDevice {
  ... (giữ nguyên serial/status/currentAgentId/currentCustomerId/currentTid/warehouseLoc/note)
  posModelId      Int?     // THAY model(text) bằng FK PosModel (master §C7)
  supplierId      Int?     // NCC nhập gần nhất (master §C6)
  intakeStatusId  Int?     // trạng thái nhập (§C8a) — Máy mới/cũ/đổi/thuê
  importPrice     Int?     // giá nhập gần nhất
  importedAt      DateTime? // ngày nhập
  bankId          Int?     // (tùy chọn) THAY bank(text) bằng FK Bank — thống nhất với TID
  // audit thiếu → BỔ SUNG:
  createdBy  Int?
  updatedBy  Int?
  deletedBy  Int?
  deletedAt  DateTime?  // để hỗ trợ Thùng rác + soft-delete như các bảng khác
}
```

- Giữ `model`/`bank` (text) **tạm thời** để không mất dữ liệu cũ; sau backfill sang `posModelId`/`bankId` thì deprecate (không xóa cột ở pha K để an toàn).
- **`PosIntake` giữ lại làm bảng LỊCH SỬ NHẬP** (mỗi lần nhập/đổi NCC 1 dòng), KHÔNG xóa. Bỏ ràng buộc `serial @unique` **về mặt ý niệm** (1 máy có thể nhập nhiều lần?) — **cần Mr.Long chốt** (Q-P3). Trước mắt giữ nguyên schema `PosIntake`, chỉ đổi HÀNH VI: `createPosIntake` sẽ **upsert `PosDevice`** trong cùng `$transaction`.

**Phương án gọn hơn (thay thế, cần chốt Q-P1):** gộp hẳn field nhập vào `PosDevice`, biến "Nhập kho" thành đúng hành vi `createPos` (1 form tạo máy), và `PosIntake` chỉ còn là các dòng `AssetEvent(STOCK_IN)` (đã có sẵn `beforeJson/afterJson`). Ưu điểm: 1 bảng máy duy nhất, không còn khái niệm "phiếu nhập" tách rời. Nhược: mất bảng giá-nhập-có-cấu-trúc nếu cần báo cáo tồn kho theo lô.

### 2.2 Migration an toàn (backfill)

Thứ tự (idempotent, chạy trong 1 transaction/script có backup trước — R7):
1. `prisma migrate` thêm cột mới vào `pos_devices` (nullable — không phá dữ liệu cũ).
2. **Backfill PosDevice từ PosIntake**: với mỗi `PosIntake` còn sống (`deletedAt=null`) mà `serial` CHƯA có trong `pos_devices` → tạo `PosDevice { serial, status:'IN_STOCK', posModelId, supplierId, intakeStatusId, importPrice, importedAt, createdBy }` + 1 `AssetEvent(STOCK_IN, occurredAt=importedAt)`.
3. Với `serial` ĐÃ có ở cả 2 bảng → chỉ **điền các cột nhập còn trống** trên `PosDevice` (không ghi đè trạng thái vận hành đang chạy).
4. Backfill `posModelId` từ `model`(text) nếu match được tên/mã `PosModel`; không match → để null + log để người dùng gán tay.
5. **Đối soát**: đếm `pos_intakes` (distinct serial, alive) == số `pos_devices` tương ứng. Log chênh lệch.

**Rủi ro di trú:** serial ở `pos_intakes` có thể trùng serial đã `RETIRED` ở `pos_devices`; hoặc `model` text không map được master. → xử lý: không đụng máy `RETIRED`, phần không map để null + báo cáo.

### 2.3 UI hợp nhất — 1 trang "Quản Lý Máy POS" nhiều tab

```
Quản Lý Máy POS
├─ Tab [Danh sách máy]   ← nguồn sự thật: PosDevice. StatBar theo status (IN_STOCK/DEPLOYED/IN_REPAIR/DAMAGED/RETIRED).
│    Cột: serial · chủng loại(PosModel) · NCC · giá nhập · ngày nhập · trạng thái · TID hiện tại · khách · đại lý
│    Hành động dòng: Triển khai(gán TID/giao khách) · Thu hồi · Chuyển đại lý · Báo hỏng · Gửi/nhận sửa · Thanh lý
├─ Tab [Nhập kho]        ← FORM = TẠO MÁY (createPosIntake → upsert PosDevice IN_STOCK). Bảng lịch sử nhập bên dưới.
├─ Tab [Nhà cung cấp]    ← §C6 (giữ nguyên CRUD)
├─ Tab [Chủng loại POS]  ← §C7 (giữ nguyên CRUD)
└─ Tab [Trạng thái nhập] ← §C8a (giữ nguyên CRUD)
```

**Menu Dashboard:** BỎ mục `possupply` ("Cấu hình máy POS"). Giữ 1 mục `pos` = "Quản Lý Máy POS" gồm tất cả tab trên. Quyền xem tab cấu hình (NCC/chủng loại/trạng thái/nhập) vẫn theo `CONFIG_POS_SUPPLY_*`; tab danh sách + hành động vận hành theo `POS_*`. (Ẩn tab nếu thiếu quyền.)

### 2.4 Luồng liên thông (sửa desync #22)

Mọi bước trong cùng `$transaction`, ghi `AssetEvent` + audit:
- **Nhập kho** → `PosDevice` `IN_STOCK` (+ dòng `PosIntake` lịch sử + `AssetEvent(STOCK_IN)`).
- **Gán TID** (`assignTid` / `deployPos`): máy `IN_STOCK → DEPLOYED`, set `currentTid` + `currentCustomerId`; TID `UNASSIGNED → ACTIVE`. (Nay chạy được vì máy đã có trong `pos_devices`.)
- **Thu hồi TID** (`recallTid`): TID `→ RECALLED`, unbind; máy: clear `currentTid`. **Cần chốt Q-P2:** thu hồi TID có tự đưa máy `DEPLOYED → IN_STOCK` không, hay máy vẫn ở khách chờ TID mới?
- **Thu hồi máy** (`recallPos`): `DEPLOYED → IN_STOCK`, clear khách/đại lý. **Bổ sung:** nếu máy còn `currentTid` → **unbind TID** đó (set TID về trạng thái phù hợp) trong cùng transaction — hiện `recallPos` KHÔNG đụng TID (rủi ro mồ côi).
- **Thanh lý máy** (`retirePos`, cần mật khẩu): `→ RETIRED`; nếu còn `currentTid` → unbind + đóng TID.

### 2.5 Vòng đời máy POS đầy đủ (Mr.Long 11/7) — Tồn kho / Triển khai / Hỏng / Bảo hành / Thu hồi / Thanh lý

Nhãn nghiệp vụ ↔ `posDevice.status` (enum hiện có, `asset.rules.ts`):

| Nhãn UI (tiếng Việt) | `posDevice.status` | Ghi chú |
|----------------------|--------------------|---------|
| **Tồn kho** | `IN_STOCK` | Trong kho ta, chưa/đã gỡ khỏi khách |
| **Đã triển khai** (gán TID + giao) | `DEPLOYED` | Đang chạy tại khách/đại lý |
| **Hỏng** | `DAMAGED` | Báo hỏng |
| **Bảo hành** | `IN_REPAIR` | Đang sửa/bảo hành |
| **Thu hồi** | (về `IN_STOCK`) | Thu hồi = hành động đưa `DEPLOYED → IN_STOCK`; KHÔNG có enum riêng. **Cần chốt Q-P5:** có cần trạng thái `RECALLED` riêng cho máy (như TID) để phân biệt "vừa thu hồi" vs "tồn kho gốc" không? |
| **Thanh lý** | `RETIRED` | Loại bỏ vĩnh viễn (cần mật khẩu) |

**State machine hiện tại** (`POS_TRANSITIONS`, giữ nguyên, làm rõ):
- `deploy`: `IN_STOCK → DEPLOYED`
- `recall`: `DEPLOYED → IN_STOCK`
- `transferAgent`: `DEPLOYED → DEPLOYED` (đổi đại lý)
- `reportDamage`: `DEPLOYED|IN_STOCK → DAMAGED`
- `sendRepair`: `DAMAGED → IN_REPAIR`
- `receiveRepaired`: `IN_REPAIR → IN_STOCK`
- `retire`: `IN_STOCK|DEPLOYED|IN_REPAIR|DAMAGED → RETIRED`

**Máy đã gán TID khi Hỏng / Thu hồi / Bảo hành — TID xử lý thế nào (đề xuất + cần chốt Q-P6):**

| Sự kiện máy | Đề xuất mặc định với TID trên máy | Ghi chú |
|-------------|-----------------------------------|---------|
| **Thu hồi máy** (`recall`) | **Gỡ gán TID** (unbind, TID về "Chưa gán máy"); chiều "Giao khách" giữ nguyên | Máy về kho, TID có thể lắp máy khác |
| **Hỏng** (`reportDamage`) | **GIỮ gán TID** (chỉ máy đổi trạng thái) HOẶC gỡ — cần chốt | Nếu giữ, TID vẫn "Đã gán máy X (hỏng)" |
| **Bảo hành** (`sendRepair`) | **Giữ gán TID** (máy tạm đi sửa, TID chờ) | |
| **Thanh lý** (`retire`) | **Bắt buộc gỡ gán TID** + đóng/thu hồi TID | Máy biến mất vĩnh viễn |

Hiện code `recallPos`/`retirePos` KHÔNG đụng `currentTid` → **rủi ro mồ côi**; K1 phải bổ sung xử lý TID trong cùng `$transaction` theo bảng trên.

---

## 3. ĐỀ XUẤT — CỤM TID

### 3.1 Mô hình dữ liệu hợp nhất

**Không cần đổi schema `tids`** — đã gộp sẵn. Việc chính là **hợp nhất 2 service + 2 UI thành 1** và **thống nhất 1 form tạo đầy đủ**.

- Bỏ đường tạo tối giản `createTid` (chỉ tid/mid/bank text) — thay bằng 1 form tạo TID đầy đủ (như `createConfigTid`) nhưng **cho phép chưa gán máy**.
- Deprecate `bank`(text) → dùng `bankId`(FK). Giữ cột `bank` để không mất dữ liệu cũ; backfill `bankId` từ `bank` khi map được mã Bank.
- Thống nhất 1 permission set. **Cần chốt Q-T4:** giữ `TID_*` hay `CONFIG_TID_*` làm bộ quyền duy nhất, hay giữ cả 2 (VIEW gộp, MANAGE tách cấu-hình vs vận-hành)?

### 3.2 TID có 2 TRẠNG THÁI ĐỘC LẬP (Mr.Long khóa 11/7)

**QUAN TRỌNG:** trạng thái TID KHÔNG phải 1 enum tuyến tính. Là **2 chiều độc lập**, dùng ĐÚNG tên gọi Mr.Long khóa:

| # | Tên trạng thái | Giá trị | Ý nghĩa | Field đề xuất |
|---|----------------|---------|---------|----------------|
| **1** | **"Gán máy POS"** | {**Đã gán máy** / **Chưa gán máy**} | TID đã được lắp lên 1 máy POS của TA chưa | `deviceAssigned` = **derive** `posSerial != null` |
| **2** | **"Giao cho khách"** | {**Đã giao** / **Chưa giao**} | Máy POS/TID đã bàn giao cho khách chưa | `customerDeliveredAt` (`deliveredAt` hiện có) — **derive** `delivered = customerDeliveredAt != null` |

**Hai chiều độc lập → 4 tổ hợp ĐỀU HỢP LỆ:**

| Gán máy POS | Giao cho khách | Trường hợp thực tế |
|-------------|----------------|---------------------|
| Đã gán máy | Chưa giao | Máy ta đã lắp TID, còn ở kho ta |
| Đã gán máy | Đã giao | Đã lắp + giao khách (luồng chuẩn) |
| Chưa gán máy | Chưa giao | TID mới cấp, chờ trong kho TID |
| **Chưa gán máy** | **Đã giao** | **Máy CỦA KHÁCH** — TID cấp cho máy khách tự có, KHÔNG nằm trên `PosDevice` của ta |

→ **Gán TID lên máy và Giao khách là 2 THAO TÁC RIÊNG**, không bắt buộc cùng lúc. Giao khách có thể xảy ra khi CHƯA gán máy ta (máy của khách).

**Map với `tids.status` hiện có** (cần làm rõ vì state machine đang tuyến tính):
- `tids.status` (UNASSIGNED|ACTIVE|DEAD|CLOSED|RECALLED) hiện **trộn lẫn** cả "gán máy" (UNASSIGNED vs ACTIVE) lẫn vòng đời kết thúc (DEAD/CLOSED/RECALLED). Nó KHÔNG biểu diễn được ô "Chưa gán máy + Đã giao".
- **Đề xuất (cần chốt Q-T1):** tách 2 chiều ra khỏi `status`:
  - Chiều 1 "Gán máy POS" = **derive từ `posSerial`** (không cần cột mới; nếu muốn tường minh thì thêm cột bool `deviceAssigned`).
  - Chiều 2 "Giao cho khách" = **`customerDeliveredAt`** (đổi tên/giữ `deliveredAt`).
  - `status` chỉ còn giữ **vòng đời sống/chết** của TID: ACTIVE (đang dùng) / DEAD / CLOSED / RECALLED. Bỏ ý nghĩa "gán máy" khỏi UNASSIGNED→ACTIVE (hoặc coi UNASSIGNED = ACTIVE-chưa-gán).
  - Nhánh assignTid vẫn set posSerial; markTidDelivered vẫn set customerDeliveredAt — **độc lập nhau**.
- Điều này cho phép: TID `ACTIVE` + `posSerial=null` + `customerDeliveredAt!=null` = "Chưa gán máy + Đã giao" (máy khách) — hợp lệ.

### 3.3 TID cấp mới: đầu vào linh hoạt

Form "Thêm TID" cho phép chọn (2 chiều độc lập, không ép cùng lúc):
- **Gán máy?** — (a) gán ngay lên máy `IN_STOCK` của ta / (b) chưa gán (kho TID chờ) / (c) máy của khách (không gán PosDevice ta, chỉ ghi thông tin máy khách nếu cần — xem Q-T6).
- **Giao khách?** — đánh dấu đã giao hay chưa (đặt `customerDeliveredAt`).

→ Cả gán máy lẫn giao khách đều KHÔNG bắt buộc lúc tạo; làm sau ở danh sách bằng 2 hành động riêng.

### 3.4 Quản lý TID + StatBar theo CẢ 2 CHIỀU

**Thiết kế UI (dùng đúng 2 tên "Gán máy POS" / "Giao cho khách"):**
- **2 nhóm StatBar riêng**:
  - Nhóm "Gán máy POS": [Đã gán máy] · [Chưa gán máy].
  - Nhóm "Giao cho khách": [Đã giao] · [Chưa giao].
  - (Tùy chọn) **ma trận 2×2** gán×giao cho 4 ô tổ hợp.
- **2 bộ lọc độc lập**: dropdown "Gán máy POS" + dropdown "Giao cho khách" (kết hợp AND). Cộng filter vòng đời (ACTIVE/DEAD/CLOSED/RECALLED) như phụ.
- **2 cột trong bảng**: cột "Gán máy POS" (badge Đã/Chưa + serial nếu có) + cột "Giao cho khách" (badge Đã/Chưa + ngày giao).
- Hành động dòng: **Gán máy** (khi chưa gán) · **Giao khách / Hủy giao** (đánh dấu chiều 2) · Thay TID · Thu hồi.

Hiện `TidPage` StatBar đang đếm theo `status` + 1 ô "Chưa giao" — **thay bằng 2 nhóm 2 chiều** ở trên.

### 3.5 UI hợp nhất — 1 trang "Quản Lý TID" nhiều tab

```
Quản Lý TID
├─ Tab [Danh sách TID]    ← nguồn: tids. StatBar 6 trạng thái + filter + (tùy) nhóm theo trạng thái.
│    Cột: TID · MID · HKD · ngân hàng · đối tác · POS · khách · trạng thái · ngày cấp · đã giao
│    Nút [+ Thêm TID] → form 3.5. Hành động dòng: Gán máy · Thay TID · Giao khách · Thu hồi.
└─ Tab [Trạng thái TID cấu hình]  ← §9a CRUD `TidConfigStatus` (giữ nguyên)
```

**Menu Dashboard:** BỎ mục `tidcfg` ("Cấu hình TID"). Giữ 1 mục `tid` = "Quản Lý TID" (badge "TID chưa giao" giữ nguyên).

### 3.6 Form "Thêm TID" — chuỗi phụ thuộc (yêu cầu Mr.Long)

Thứ tự nhập, mỗi bước lọc bước sau:
1. **HKD** (chọn từ danh sách `Dossier`/HKD) → suy ra ngữ cảnh.
2. **Đối tác** (`Partner`) → tra biểu phí (`FeeRate`).
3. **Ngân hàng** (`Bank`): lọc theo `PartnerBank` (đối tác↔ngân hàng). **Quy tắc ưu tiên:** nếu đối tác chỉ liên kết **1 ngân hàng → tự chọn mặc định**; nếu **≥2 → hiện dropdown** để chọn.
4. **Chuỗi TID** (bắt buộc, unique) + **Chuỗi MID**.
5. (Tùy chọn) TK nhận tiền, nguồn hồ sơ, trạng thái cấu hình, ngày cấp.
6. Chọn chế độ: **(a) gán máy ngay** (chọn máy IN_STOCK + khách) hoặc **(b) chưa gán**.

---

## 4. TIMELINE / LỊCH SỬ SỰ KIỆN (Mr.Long: "chưa thấy timeline")

### 4.1 Hiện trạng (đã verify)
- **Cấp MÁY POS ĐÃ CÓ timeline**: `PosPage.tsx` `TimelineModal` (nút "Vòng đời") → API `posTimeline(serial)` → `getDeviceTimeline` đọc `AssetEvent` theo `deviceSerial`, hiển thị dọc: nhãn + `from→to` + ngày giờ + note.
- **VÌ SAO Mr.Long CHƯA THẤY:**
  1. Máy nhập qua "Nhập kho" (`PosIntake`) KHÔNG tạo `PosDevice` → không lên "Quản lý máy POS" → không có nút "Vòng đời" → **không có timeline**. → **Fix gốc = hợp nhất POS (K1)**: nhập kho ⇒ tạo `PosDevice` `IN_STOCK` + ghi `AssetEvent(STOCK_IN)` ⇒ **mọi máy đều có timeline**.
  2. **TID CHƯA có timeline riêng** (chỉ có ở cấp máy). → **Thêm timeline cấp TID** (K2).

### 4.2 Mô hình — bảng `AssetEvent` đã đủ cột nghiệp vụ
`AssetEvent` hiện có: `deviceSerial`, `tid`, `eventType`, `fromState`, `toState`, `fromAgentId`, `toAgentId`, `customerId`, `actorUserId`, `occurredAt`, `note`, `beforeJson`, `afterJson`. Index sẵn theo `deviceSerial` VÀ `tid` → **truy timeline từ cả 2 phía được ngay**.

→ **Đủ cột để hiển thị "giao cho KH X qua đại lý Y ngày Z"**: `customerId` + `toAgentId` + `occurredAt`. **Thiếu:** không có `tidId` (chỉ `tid` string) — chấp nhận được vì join bằng chuỗi TID (giống `deviceSerial`). Nếu muốn chặt hơn có thể thêm `tidId` (Q-TL2).

**Nguyên tắc: timeline TỰ SINH — người dùng KHÔNG nhập tay.** Mỗi thao tác nghiệp vụ ghi 1 `AssetEvent` tự động trong cùng `$transaction` với thao tác đó (đã là pattern hiện tại; K1/K2 chỉ bổ sung các event còn thiếu).

### 4.3 Danh mục event bắt buộc ghi đủ (cả MÁY và TID)

| Giai đoạn (nhãn tiếng Việt) | eventType | Ghi hiện chưa? | deviceSerial | tid | customerId | agentId | occurredAt |
|------------------------------|-----------|----------------|:---:|:---:|:---:|:---:|:---:|
| Nhập kho | `STOCK_IN` | ✅ (chỉ khi qua `createPos`; **thiếu khi qua `PosIntake`** → K1 thêm) | ✅ | – | – | – | ngày nhập |
| Gán TID lên máy | `TID_ASSIGN` | ✅ | ✅ | ✅ | ✅ | (đại lý máy) | ngày gán = `assignedAt` |
| Giao cho khách | `TID_DELIVERED` | ✅ (nhưng **thiếu agentId** trong sự kiện giao) → K2 bổ sung `toAgentId` | ✅ | ✅ | ✅ | **✅ cần thêm** | ngày giao = `deliveredAt` |
| Thu hồi TID | `TID_RECALL` | ✅ | ✅ | ✅ | ✅ | | |
| Đổi TID | `TID_DEAD` + `TID_REPLACE` | ✅ | ✅ | ✅ | ✅ | | |
| Triển khai máy | `DEPLOY` | ✅ | ✅ | | ✅ | ✅ | |
| Thu hồi máy | `RECALL` | ✅ | ✅ | | | | |
| Chuyển đại lý | `TRANSFER_AGENT` | ✅ | ✅ | | | ✅ | |
| Báo hỏng | `REPORT_DAMAGE` | ✅ | ✅ | | | | |
| Gửi bảo hành | `SEND_REPAIR` | ✅ | ✅ | | | | |
| Nhận sửa xong | `RECEIVE_REPAIRED` | ✅ | ✅ | | | | |
| Thanh lý | `RETIRE` | ✅ | ✅ | | | | |

**Việc phải làm:**
- K1: `createPosIntake` ghi `STOCK_IN` (đang thiếu).
- K2: sự kiện **Giao cho khách** (`markTidDelivered`) hiện set `customerId` (từ row) + `occurredAt` nhưng **KHÔNG set `toAgentId`** (đại lý) → **bổ sung đủ 3 field: ngày giao + khách + đại lý** (yêu cầu Mr.Long: cả 3 bắt buộc trong sự kiện giao). Ngoài ra khi "Giao khi chưa gán máy" (máy khách) thì `customerId` chưa có từ assign → form Giao phải cho nhập khách + đại lý trực tiếp.
- Đảm bảo mọi event ghi `tid` khi có TID liên quan để timeline TID đầy đủ.

### 4.4 UI timeline — 2 phía

Cột hiển thị (cả cấp máy và cấp TID): **mốc (nhãn) | ngày giờ | máy/serial | trạng thái from→to | khách hàng | đại lý | ghi chú**.

- **Chi tiết máy POS** (đã có `TimelineModal`): giữ, thêm cột khách/đại lý (đọc `customerId`/`toAgentId` → tên).
- **Chi tiết TID** (MỚI, K2): nút "Vòng đời TID" trong module TID → API `tidTimeline(tid)` đọc `AssetEvent WHERE tid = ?` (index có sẵn) → cùng layout. Chuỗi ví dụ: *Cấp mới → Gán lên máy SN123 (12/7) → Giao cho KH "Quán A" qua đại lý "ĐL Bình" (15/7) → Thu hồi (20/7)*.

Yêu cầu Mr.Long — timeline TID thể hiện đủ mốc + dữ liệu:
1. **Ngày gán** (`assignedAt` = occurredAt của `TID_ASSIGN`) + **máy nào** (serial).
2. Phân biệt rõ **"Đã gán máy + Chưa giao (còn tồn kho)"** vs **"Đã giao"** — hiển thị badge 2 chiều (§3.2).
3. **"Chưa gán máy + Chưa giao"** — thể hiện là mốc "Cấp mới" chưa có event gán/giao.
4. **Khi giao**: ngày giao (`deliveredAt`) + giao cho ai (`customerId`) + qua đại lý nào (`agentId`) — cả 3 trong 1 dòng event.

---

## 5. PHÂN PHA BUILD (mỗi pha 1 gate + selftest)

| Pha | Nội dung | Gate / selftest |
|-----|----------|------------------|
| **K1 — POS unify + timeline gốc** | schema (+cột nhập vào PosDevice, +audit/soft-delete) → migration backfill từ PosIntake → `createPosIntake` upsert PosDevice `IN_STOCK` + ghi `AssetEvent(STOCK_IN)` → xử lý TID khi thu hồi/hỏng/bảo hành/thanh lý (§2.5) → gộp UI PosPage 5 tab → sửa menu | Selftest concurrency (2 nhập cùng serial), cross-entity (assign TID lên máy vừa nhập chạy được), backfill idempotent (chạy 2 lần không nhân đôi), recallPos/retirePos unbind TID, **mọi máy đều có nút Vòng đời + STOCK_IN** |
| **K2 — TID unify + timeline TID** | gộp 2 service/2 UI → 1 form tạo (gán? / giao? độc lập) → 2 chiều "Gán máy POS" + "Giao cho khách" (StatBar/filter/cột theo §3.4) → sự kiện Giao ghi đủ ngày+khách+đại lý → **timeline TID mới** (`tidTimeline`) → chuỗi HKD→đối tác→bank(ưu tiên 1/2+)→TID/MID → deprecate bank text → sửa menu | Selftest: 4 tổ hợp gán×giao (gồm "chưa gán + đã giao" = máy khách) đếm/lọc đúng; tạo TID chưa gán rồi gán sau; giao khi chưa gán; sự kiện Giao có đủ customerId+agentId; timeline TID hiển thị đủ mốc; regression assign/replace/recall/deliver |

Tuân R_SUPREME workflow: K1 build → unit test → regression → production validation → freeze → tag → rồi mới K2. KHÔNG build song song.

---

## 6. RỦI RO / PHẢN BIỆN (≥5) + cách chặn

1. **Mất dữ liệu khi backfill POS**: serial trùng giữa 2 bảng, ghi đè nhầm trạng thái vận hành. → Chặn: backfill chỉ ĐIỀN cột trống, KHÔNG đụng `status/currentTid/currentCustomerId`; backup trước; script idempotent + đối soát đếm.
2. **Bản ghi mồ côi TID↔POS**: thu hồi/thanh lý máy còn `currentTid`, hoặc thu hồi TID mà máy vẫn DEPLOYED. → Chặn: mọi transition đụng cả 2 phía trong cùng `$transaction` (bổ sung unbind TID vào `recallPos`/`retirePos`).
3. **Máy nhập kho chưa map chủng loại/bank** (model text không match master). → Chặn: cho null + báo cáo danh sách "cần gán tay", không chặn nhập.
4. **Quyền lệch sau khi gộp menu**: người chỉ có `CONFIG_POS_SUPPLY_*` (kho) mất quyền, hoặc thấy tab vận hành. → Chặn: ẩn/hiện TỪNG tab theo quyền; giữ 2 bộ quyền, không ép hợp nhất; kiểm thử theo vai (WAREHOUSE/TECHNICIAN/D_MANAGER). (Bài học seed quyền role cũ 9/7 — test class "DB tiến hóa".)
5. **Trộn 2 chiều vào 1 enum `status`**: hiện `status` gánh cả "gán máy" lẫn "sống/chết" → không biểu diễn được "Chưa gán + Đã giao" (máy khách). → Chặn: tách 2 chiều thành derive `posSerial`/`customerDeliveredAt`, `status` chỉ giữ vòng đời sống-chết; giữ state machine cũ tương thích, thêm test 4 tổ hợp.
6. **Sự kiện Giao thiếu dữ liệu** (`markTidDelivered` không ghi customerId/agentId vào AssetEvent) → timeline không hiện "giao cho ai/đại lý nào". → Chặn: K2 bắt buộc 3 field ngày+khách+đại lý trong event `TID_DELIVERED`.
7. **TID mồ côi timeline khi máy nhập kho không tạo PosDevice** → Mr.Long "chưa thấy timeline". → Chặn: K1 backfill + STOCK_IN cho mọi máy.
8. **PosIntake vẫn cho phép nhập serial đã tồn tại ở PosDevice**: 2 nguồn tạo máy song song lại tái diễn desync. → Chặn: sau K1, `createPos` (tạo tay) và `createPosIntake` (nhập kho) DÙNG CHUNG 1 hàm upsert PosDevice; cấm đường tạo PosDevice độc lập không qua nhập kho (hoặc hợp nhất luôn — Q-P1).
9. **Regression export CSV / Dashboard KPI** (đếm `pos_devices` vs `pos_intakes`): sau gộp, con số có thể đổi. → Chặn: rà `dashboard-service` đếm theo nguồn mới, cập nhật + snapshot test.

---

## 7. CÂU HỎI CẦN MR.LONG CHỐT

**Cụm POS:**
- **Q-P1**: `PosIntake` giữ làm **bảng lịch sử nhập** (mỗi lần nhập 1 dòng) hay **gộp hẳn** vào `PosDevice` + `AssetEvent(STOCK_IN)` (bỏ bảng phiếu nhập riêng)?
- **Q-P2**: **Thu hồi TID** khỏi 1 máy có tự đưa máy `DEPLOYED → IN_STOCK` không, hay máy vẫn ở khách chờ gán TID mới (chỉ clear `currentTid`)?
- **Q-P3**: 1 máy (serial) có được **nhập kho nhiều lần** không (nhập lại sau khi thu hồi/đổi NCC)? Ảnh hưởng ràng buộc `serial @unique` trên `pos_intakes`.
- **Q-P4**: `PosDevice.bank`/`model` (text tự do) — chuyển hẳn sang FK `bankId`/`posModelId`? Với dữ liệu cũ không map được master thì để trống chờ gán tay, đúng không?
- **Q-P5**: Máy **"Thu hồi"** có cần trạng thái `RECALLED` RIÊNG (như TID) để phân biệt với "Tồn kho gốc" không, hay về thẳng `IN_STOCK`?
- **Q-P6**: Máy đã gán TID khi **Hỏng / Bảo hành** — **GIỮ hay GỠ** gán TID? (Đề xuất: Thu hồi=gỡ, Hỏng/Bảo hành=giữ, Thanh lý=bắt buộc gỡ — §2.5.)

**Cụm TID:**
- **Q-T1**: Đồng ý mô hình **2 chiều độc lập** — "Gán máy POS" (derive `posSerial`) + "Giao cho khách" (`customerDeliveredAt`), tách khỏi `status` (chỉ giữ sống/chết)? (Khuyến nghị.) Có cần thêm cột bool `deviceAssigned` tường minh không hay derive là đủ?
- **Q-T2**: Danh sách TID — muốn **ma trận 2×2** (gán×giao) hay chỉ **2 bộ lọc + 2 nhóm StatBar** độc lập là đủ?
- **Q-T3**: Trong form "Thêm TID", chuỗi phụ thuộc bắt đầu từ **HKD** hay từ **Đối tác**? (Hiện `createConfigTid` bắt buộc bankId+partnerId+hkdName; HKD đang là text `hkdName`, chưa link `Dossier` — có muốn đổi thành CHỌN từ danh sách HKD không?)
- **Q-T4**: Hợp nhất quyền: giữ cả `TID_*` (vận hành) và `CONFIG_TID_*` (cấu hình) trên cùng 1 trang (ẩn/hiện theo tab), hay gộp về 1 bộ quyền duy nhất?
- **Q-T5**: Bỏ đường tạo tối giản `createTid` (chỉ tid/mid/bank) — đồng ý dùng DUY NHẤT form đầy đủ chứ? (Ảnh hưởng nếu có nơi khác gọi `createTid`.)
- **Q-T6 (máy của khách)**: Với tổ hợp "**Chưa gán máy + Đã giao**" (TID cấp cho máy khách tự có) — có cần **lưu serial/thông tin máy khách** không, hay chỉ đánh dấu "máy khách" + lưu khách/đại lý? Nếu cần serial máy khách thì lưu ở đâu (field text trên `tids` vs không tạo `PosDevice`)?

**Timeline:**
- **Q-TL1 (đại lý)**: "Giao cho đại lý" — đại lý dùng bảng `Agent` hiện có (FK `agentId`) hay text? Và **giao cho khách có BẮT BUỘC qua đại lý không**, hay đại lý là tùy chọn?
- **Q-TL2**: Có cần thêm cột `tidId` (FK) vào `AssetEvent` để join chặt hơn (thay vì join bằng chuỗi `tid`), hay giữ chuỗi như `deviceSerial` là đủ?

---

## 8. GHI CHÚ THỰC THI
- Đây là ĐỀ XUẤT. Theo R7: Read→Diff→Proposal→**Approval**→Backup→Patch→Regression→Production. Chưa được duyệt thì KHÔNG sửa code/schema.
- Mọi migration phải có backup + đối soát trước/sau (R9 evidence-first). Sau mỗi bug phát sinh khi build → thêm regression test (test process failure principle).
