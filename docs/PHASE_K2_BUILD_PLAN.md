# PHASE K2 — BUILD PLAN (Hợp nhất TID + Timeline TID)

> Trạng thái: KẾ HOẠCH + QUYẾT ĐỊNH CHỐT (LEAD). Bám `PHASE_K_DECISIONS.md` (Q-T1..T6, Q-TL1/2). Chạy SAU khi K1 tag `v0.22.0-k1` (ĐÃ tag). Repo canonical DUY NHẤT `D:\TT HKD AI\tools\quan-ly-glb` — CẤM đụng clone C:. Build agent KHÔNG commit (chỉ LEAD sau AUDIT).
> Nguồn: kế hoạch từ agent kiến trúc read-only (đã đọc working tree K1). Mọi file:dòng bám code hiện tại (sau K1 commit).

## 0. 5 QUYẾT ĐỊNH LEAD CHỐT (Mr.Long chọn B — theo mặc định LEAD)
- **D1 (quyền form picker):** Thêm **endpoint lite `tidRefs()`** guard `CONFIG_TID_VIEW` trả lite HKD + partner + bank + map PartnerBank. KHÔNG sửa `permissions.ts` (giữ role cũ, tránh rủi ro seed 9/7). WAREHOUSE (có CONFIG_TID_MANAGE) dùng form được qua endpoint này. Pattern giống bankLite/listSuppliersLite.
- **D2 (chuỗi HKD→partner→bank):** XÁC NHẬN — Dossier KHÔNG link Partner (không có quan hệ dữ liệu). Chuỗi thực: HKD → chỉ gắn `dossierId` (không lọc partner); Đối tác → list toàn bộ; **Ngân hàng → lọc theo `PartnerBank`** (1 liên kết→auto-chọn, ≥2→dropdown, 0→cảnh báo).
- **D3 (Q-T5 mức độ):** GIỮ `createTid` làm **helper nội bộ** cho selftest (gpos #96/97/99/138, posunify #57/78/94 — KHÔNG vỡ), chỉ **GỠ đường UI/IPC tối giản** (`tid:create` tối giản → unified). KHÔNG xóa cứng.
- **D4 (recallTid):** SỬA `recallTid` clear `posSerial`+`agentId` khi →RECALLED (nhất quán derive "gán máy") + regression.
- **D5 (gộp service):** GIỮ 2 file (`tid-service.ts` + `tid-config-service.ts`), thêm hàm hợp nhất ở `tid-service.ts` import helper từ `tid-config-service.ts`. UI gọi 1 bề mặt. KHÔNG gộp 1 file (giảm bán kính).

## 1. Q-T1 — 2 chiều trạng thái DERIVE (không cột bool)
- `tid-service.ts TidDto`: THÊM `deviceAssigned:boolean` (=`posSerial!=null`), `delivered:boolean` (=`deliveredAt!=null`), `customerDeviceSerial:string|null`, `dossierId:number|null`. `toDto` compute. KHÔNG thêm cột DB bool. `status` chỉ giữ lifecycle.
- DTO list hợp nhất: trả CẢ nhóm vận hành (posSerial/status/deliveredAt/customerId/agentId) LẪN cấu hình (bankId/partnerId/hkdName/issuedAt/configStatusName…).
- `listUndeliveredTids` (tid-service.ts ~92-101): sửa thành `deletedAt:null` (HIỆN THIẾU — bug soft-delete) + `status notIn [DEAD,CLOSED,RECALLED]` + `deliveredAt:null`; bỏ mệnh đề `OR status=UNASSIGNED` (thừa). Đồng bộ `notification-service.ts:20` (badge) + selftest badge.
- Tương thích K1: assignTid nay key theo posSerial (from∈{UNASSIGNED,ACTIVE}) — giữ.

## 2. Q-T5+Q-T4 — Gộp service, gỡ đường UI/IPC createTid tối giản, giữ 2 bộ quyền
- Caller `createTid`: ipc.ts:156 (`tid:create`) → đổi sang `createTidUnified`; preload/index.ts:83 (`tidCreate`) payload đầy đủ; d.ts:234 `CreateTidInput` + :1062 (**Edit**, mở rộng); TidPage.tsx:265 UI form đầy đủ. Selftest gpos/posunify GIỮ dùng helper `createTid` (D3).
- `createTidUnified(input)` (tid-service.ts, gom `tid-config-service.createConfigTid`): input `{tid,mid?,dossierId?,hkdName,partnerId,bankId,receiveAccountId?,issuedAt?,configStatusId?,dossierSourceId?,note?,customerDeviceSerial?,assign?:{posSerial,customerId},deliver?:{deliveredAt,customerId,toAgentId?}}`. validateRefs (tid-config-service.ts:250). assign/deliver trong cùng `$transaction`. Cho phép chưa gán + chưa giao. Perm CONFIG_TID_MANAGE (+TID_MANAGE nếu có assign/deliver).
- Q-T4 map quyền: Tab "Danh sách TID" xem = TID_VIEW OR CONFIG_TID_VIEW; "+Thêm TID" = CONFIG_TID_MANAGE (+TID_MANAGE nếu gán/giao ngay); hành động dòng Gán/Giao/Đổi/Thu hồi = TID_MANAGE; sửa/xóa cấu hình = CONFIG_TID_MANAGE; tab "Trạng thái TID cấu hình" = CONFIG_TID_VIEW/MANAGE. Ẩn/hiện theo quyền. KHÔNG sửa permissions.ts.

## 3. Q-T3 — Form Thêm TID chuỗi phụ thuộc (Mr.Long KHÓA)
Thứ tự: HKD (Dossier) → Đối tác → Ngân hàng (lọc PartnerBank) → Chuỗi TID → Chuỗi MID → tùy chọn (TK nhận/nguồn hồ sơ/trạng thái cấu hình/ngày cấp/serial máy khách) → chế độ gán (a ngay/b chưa/c máy khách) + giao (đánh dấu).
- API: dùng endpoint lite `tidRefs()` (D1) cho HKD/partner/bank/partnerBank. Bank-theo-partner lọc client từ `partner.bankIds` (bank-config-service.ts:415): 1→auto+disable, ≥2→dropdown, 0→cảnh báo.
- UI: `TidPage.tsx` thay `TidForm` (255-299) bằng form chuỗi; tái dùng dropdown + `FeePreview` từ `TidConfigPage.tsx:259/289-342`. hkdName tự điền từ HKD.

## 4. Q-T2/§3.4 — 1 trang nhiều tab + 2 StatBar + 2 filter + 2 cột (TidPage.tsx)
- Tabs: giữ all/undelivered (16,96-103) + THÊM tab "Trạng thái TID cấu hình" (nhân TidConfigPage §9a CRUD, guard CONFIG_TID_*).
- 2 nhóm StatBar (thay 107-119): "Gán máy POS" [Đã/Chưa `deviceAssigned`]; "Giao cho khách" [Đã/Chưa `delivered`]. Đếm client. KHÔNG ma trận 2×2.
- 2 bộ lọc độc lập (mở rộng FilterBar 121-134): dropdown "Gán máy POS" + "Giao cho khách" (AND). Có thể thêm `deviceAssigned?`/`delivered?` vào `TidFilter` (where posSerial/deliveredAt null/not-null).
- 2 cột bảng (thay header 140-146 + body 174-198): "Gán máy POS" (badge + posSerial/máy khách) + "Giao cho khách" (badge + ngày deliveredAt).
- Hành động dòng (actionsFor 64-73): Gán máy/Giao khách/(Hủy giao)/Đổi TID/Thu hồi/**Vòng đời TID**.
- Dashboard.tsx: bỏ menu `tidcfg` (88) + nhánh render (315) + import (49) nếu gộp hết; giữ mục `tid` label "Quản Lý TID" perms `['TID_VIEW','CONFIG_TID_VIEW']`.

## 5. Q-T6 — Máy của khách
- Migration: `tids.customerDeviceSerial` text nullable. Schema model Tid (~242-273) `customerDeviceSerial String? @map("customer_device_serial")`.
- Form chế độ (c) + hành động Giao khi chưa gán → nhập serial máy khách (tùy chọn), KHÔNG tạo PosDevice. Cột "Gán máy POS": posSerial=null && customerDeviceSerial!=null → "Máy khách: <serial>". Tổ hợp "Chưa gán (ta) + Đã giao" hợp lệ.

## 6. §4 — Timeline TID (Q-TL1/TL2)
- **`AssetEvent.toAgentId` ĐÃ CÓ** (schema:369) → KHÔNG migration cho AssetEvent.
- `tidTimeline(tid)` (tid-service.ts, nhân getDeviceTimeline pos-service.ts:145-171): `assetEvent.findMany({where:{tid},orderBy:[{occurredAt:'asc'},{id:'asc'}]})`, guard TID_VIEW OR CONFIG_TID_VIEW, trả TimelineEventDto (đã có toAgentId/customerId). KHÔNG thêm tidId FK (Q-TL2, join chuỗi tid, index schema:379).
- IPC `tid:timeline` (ipc.ts cạnh 154-160); preload `tidTimeline` (index.ts cạnh 87); d.ts **Edit** thêm method (cạnh 1066).
- `markTidDelivered` (374-409) BỔ SUNG `toAgentId` (Q-TL1, đại lý FK Agent TÙY CHỌN) + customerId (bắt buộc, từ row hoặc form khi máy khách). MarkDeliveredInput (368-371) + d.ts:256 thêm customerId?/toAgentId?. TidActionModal (308-402) nhánh deliver: select khách + select đại lý (customerList/agentList — agent:list ipc.ts:139).
- Modal "Vòng đời TID": nhân TimelineModal PosPage.tsx:346-377. EVENT_LABELS (379-387) thêm TID_ASSIGN "Gán lên máy"/TID_DELIVERED "Giao cho khách"/TID_RECALL/TID_DEAD/TID_REPLACE/STOCK_IN/TID_UNBIND. Map customerId/agentId→tên.
- D4: sửa `recallTid` (320-366) clear posSerial+agentId.

## 7. Selftest K2 — `GLB_SELFTEST=30`, file `selftest-tidunify.ts`
Wire index.ts sau khối '29'. Ca: (1) 4 tổ hợp gán×giao đếm/lọc đúng gồm "chưa gán+đã giao"=máy khách; (2) tạo TID chưa gán → assign sau; (3) giao khi chưa gán (máy khách) customerId+toAgentId+customerDeviceSerial, posSerial null; (4) sự kiện Giao ghi đủ customerId+toAgentId; (5) tidTimeline đủ mốc đúng thứ tự; (6) regression assign/replace/recall/deliver; (7) tương thích K1: recallPos→reassign OK, recallTid→RECALLED→assign FORBIDDEN, retirePos→RECALLED+posSerial null; (8) "chưa giao" loại DEAD/CLOSED/RECALLED+soft-deleted, khớp badge; (9) quyền vai (WAREHOUSE tạo/gán/giao qua tidRefs; SALES FORBIDDEN); (10) recallTid clear posSerial (D4). DB throwaway, KHÔNG đụng glb.

## 8. Migration
Model Tid +2 cột nullable: `customerDeviceSerial` (Q-T6) + `dossierId Int? @map("dossier_id")` + `@@index([dossierId])` (Q-T3). KHÔNG cột AssetEvent, KHÔNG cột bool, KHÔNG xóa bank/hkdName text. Backup pg_dump → migrate deploy throwaway → backfill idempotent `dossierId` (khớp CHÍNH XÁC 1 Dossier.hkdName alive → set; nhiều/không khớp → null+log) → đối soát đếm.

## 9. Rủi ro
1. Quyền picker → endpoint lite tidRefs() (D1). 2. Mirror-drift d.ts (≥1000/5 anchor): CHỈ Edit, đồng bộ main DTO↔preload↔d.ts, `npm run typecheck` (CẤM tsc -p trần). 3. Quyền role cũ: giữ 2 bộ, test 3 vai. 4. Ô nhiễm "chưa giao": +deletedAt null + scope lifecycle + snapshot. 5. Backfill dossierId mơ hồ: khớp chính xác 1, còn lại null+log, idempotent. 6. recallTid drift (D4). 7. Không xóa cứng createTid (D3).

## 10. Thứ tự (mỗi bước 1 gate)
B0 tiền đề (K1 đã tag ✓, 5 QĐ chốt ✓) → B1 schema+migration+backfill (backup+đối soát) → B2 service (DTO derive/listUndelivered/createTidUnified/markTidDelivered+agent/tidTimeline/recallTid fix/tidRefs) typecheck → B3 IPC+preload+d.ts (Edit) typecheck+mirror → B4 UI TidPage (form chuỗi/2 StatBar/2 filter/2 cột/modal Vòng đời/deliver+khách+đại lý/tab cấu hình) build → B5 Dashboard bỏ tidcfg → B6 selftest 30 PASS throwaway → B7 regression 3/10/29 không vỡ → B8 AUDIT LEAD → commit+tag.
