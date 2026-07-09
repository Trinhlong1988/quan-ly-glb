# DESIGN PROPOSAL — POS/TID Asset Library + Cashflow (tư vấn, DRAFT/PENDING)

> Trạng thái: **APPROVED để BUILD phần A (POS/TID) + D (mã NV/KH + KH nickname)** — Mr.Long chốt 9/7 ("chốt thiếu bổ xung sau"). Phần B (thu chi) VẪN chờ lệnh nghiên cứu thị trường. Mở rộng IMS_SPEC roadmap. Grounded trên dữ liệu thật `globeway-quanlytaikhoan/qlpos-tid-master.json` (991 POS / 163 user / 9 bank).
> Bổ sung menu: **12. Quản lý thu chi · 13. Hướng dẫn sử dụng · 14. Đăng xuất** (14 đã có ở G1).

---

## PHẦN A — THƯ VIỆN QUẢN LÝ MÁY POS / TID (lõi nghiệp vụ GLOBEWAY)

### A0. Vấn đề Mr.Long nêu (chuẩn hóa lại)
- 1 máy POS vật lý (serial number) **gắn nhiều TID theo thời gian** (TID chết/đóng → thay TID; hoặc thu hồi cả TID+máy).
- Máy POS: hư → bảo trì → sửa xong; luân chuyển kho ↔ khách ↔ đại lý này sang đại lý khác.
- **Bắt buộc: lịch sử thao tác** (di chuyển/chuyển đổi/thu hồi/báo hỏng/gửi sửa/nhận sửa xong) **có timestamp cụ thể**, dễ tra.
- Danh sách **TID chưa giao** + **push thông báo mỗi ngày** (chưa giao = lãng phí, không ra doanh thu).

### A1. Nguyên tắc thiết kế TỐI ƯU: **Event Sourcing (nhật ký sự kiện bất biến)**
Không lưu chỉ "trạng thái hiện tại" — lưu **mọi sự kiện** đã xảy ra. Trạng thái hiện tại = chiếu (project) từ chuỗi sự kiện. Đây là chuẩn vàng cho tài sản có vòng đời phức tạp + yêu cầu "lịch sử chi tiết" + audit tài chính. Lợi ích: tra được "máy này ở đâu ngày X", ai thao tác, không mất lịch sử khi đổi TID/đại lý.

### A2. Thực thể (entities)
| Bảng | Vai trò | Field chính |
|------|---------|-------------|
| `pos_device` | Máy POS vật lý (danh tính = **serial number bất biến**) | serial, model, bank, currentStatus, currentAgentId, currentMerchantId, currentTid, warehouseLoc |
| `tid` | Terminal ID | tid, mid, bank, status (UNASSIGNED/ACTIVE/DEAD/CLOSED/RECALLED), posSerial?, merchantId?, agentId?, openedAt, closedAt |
| `merchant` | Khách hàng/điểm bán | id, name, taxCode, address, agentId |
| `agent` | Đại lý | id, name, region |
| `asset_event` | **NHẬT KÝ BẤT BIẾN** (lõi) | id, deviceSerial?, tid?, eventType, fromState, toState, fromAgentId?, toAgentId?, merchantId?, actorUserId, occurredAt, note, beforeJson, afterJson |
| `pos_tid_binding` | Gắn POS↔TID theo thời gian (đóng/mở) | posSerial, tid, boundAt, unboundAt, unbindReason |

**Quan hệ POS↔TID:** 1 POS tại 1 thời điểm có tối đa 1 TID ACTIVE, nhưng **nhiều binding lịch sử**. `pos_tid_binding` giữ lịch sử; `asset_event` giữ lý do + timestamp.

### A3. Máy trạng thái (state machine) — mỗi chuyển tiếp = 1 `asset_event`
**POS device:**
```
IN_STOCK ──deploy──▶ DEPLOYED(AT_MERCHANT) ──recall──▶ IN_STOCK
   ▲                       │
   │                    report_damage
 receive_repaired           ▼
   └──────── IN_REPAIR ◀── send_repair
DEPLOYED ──transfer_agent──▶ DEPLOYED (đại lý khác)
bất kỳ ──retire──▶ RETIRED (thanh lý)
```
**TID:** `UNASSIGNED → ACTIVE(gắn POS) → DEAD|CLOSED → RECALLED`. Thay TID = TID cũ DEAD + unbind + TID mới ACTIVE + bind (2 event, cùng deviceSerial).

**eventType tối thiểu:** `STOCK_IN, STOCK_OUT/DEPLOY, RECALL, TRANSFER_AGENT, REPORT_DAMAGE, SEND_REPAIR, RECEIVE_REPAIRED, TID_ASSIGN, TID_DEAD, TID_REPLACE, TID_RECALL, RETIRE`. Mỗi event có `occurredAt` (thời gian thao tác thực, khác created_at) → "thời gian cụ thể chi tiết" như Mr.Long yêu cầu.

### A4. Feature 1 — Thư viện POS có lịch sử
- Trang **danh sách POS** (lọc theo bank/đại lý/trạng thái/serial), mỗi máy có **Timeline** dựng từ `asset_event` (dòng thời gian: ngày → sự kiện → ai làm → ghi chú).
- Trang **TID**: TID nào đang gắn máy nào, lịch sử đổi TID.
- Thao tác đều tạo event + audit (kế thừa guard/audit G1).

### A5. Feature 2 — TID chưa giao + Push hằng ngày
- View **"TID chưa giao"** = `tid.status = UNASSIGNED` (hoặc ACTIVE nhưng chưa bind POS/merchant). Thêm **aging**: số ngày chưa giao (openedAt→nay) → nhấn mạnh lãng phí.
- **Scheduled job (cron mỗi sáng)** tổng hợp: N TID chưa giao, tổng ngày tồn, top lâu nhất → **push Zalo** (tái dùng hạ tầng gửi Zalo QLTK đã có [[project pattern]]) + toast/notification in-app.
- KPI: giảm số TID chưa giao = tăng doanh thu.

### A6. Bảo mật dữ liệu (Mr.Long nhấn mạnh)
- TID/MID/merchant/tax = **dữ liệu tài chính nhạy cảm** → permission riêng (`POS_VIEW/POS_MANAGE/TID_MANAGE/ASSET_EXPORT`), audit mọi truy cập + export.
- Mã hóa field nhạy cảm ở rest (SQLite: mã hóa cột hoặc SQLCipher khi lên .exe); export cần quyền + ghi audit.
- **Hành vi user / vi phạm:** audit_logs đã có (G1) = nền "lịch sử user"; thêm bảng `user_violation` (loại vi phạm, mức, người ghi, thời gian) + rule cảnh báo (vd thao tác ngoài giờ, export hàng loạt).

---

## PHẦN B — QUẢN LÝ THU CHI (item 12) — cần NGHIÊN CỨU THỊ TRƯỜNG
Mr.Long yêu cầu "phân tích app sẵn thị trường tối ưu". Đề xuất **nghiên cứu sâu** các app VN: KiotViet, MISA (SME/CukCuk), Sapo, POS365, Haravan — về module thu-chi/sổ quỹ:
- Danh mục thu/chi, quỹ tiền mặt vs tài khoản ngân hàng, phiếu thu/phiếu chi, đối tượng (khách/NCC/nội bộ), báo cáo dòng tiền, đối soát.
- Điểm tối ưu để bê vào IMS: liên kết doanh thu POS/TID ↔ thu chi; đối soát với tool bill/sao kê đã có.
→ **Cần Mr.Long duyệt cho em chạy deep-research** (web) rồi ra `docs/CASHFLOW_MARKET_RESEARCH.md` + đề xuất data model thu chi.

## PHẦN C — Item 13 Hướng dẫn sử dụng / Item 14 Đăng xuất
- **14 Đăng xuất:** ĐÃ có ở G1 (topbar + sidebar). ✅
- **13 Hướng dẫn sử dụng:** trang in-app (markdown viewer) + `docs/USER_GUIDE.md` — làm cùng Phase hoàn thiện UI.

---

## PHẦN D — MÃ ĐỊNH DANH TỰ SINH (Mr.Long yêu cầu 9/7)
- **Mã nhân viên** `NV01, NV02, NV03...` — auto-sinh **khi tạo user**, unique, **hiển thị đính kèm** ở list/chi tiết/form nhân sự. Cột `users.employee_code`.
- **Mã khách hàng** `KH01, KH02, KH03...` — auto-sinh **ngay lúc khởi tạo** khách hàng, unique, **hiển thị đính kèm khách hàng** (mọi nơi hiện tên KH đều kèm mã). Cột `customer.code` (thực thể `merchant`/`customer`).
- **Khách hàng có 2 tên:** `full_name` (tên thật, vd "Nguyễn Văn Thanh") + `nickname`/biệt danh **dễ gọi** (vd "Anh Thanh Hải Phòng") — trường bắt buộc cho KH, dùng để tìm/gọi nhanh. Hiển thị dạng `KH03 · Anh Thanh Hải Phòng (Nguyễn Văn Thanh)`.
- **User nhân sự KHÔNG cần biệt danh** — chỉ `full_name` + mã `NV##`.
- **Cơ chế sinh mã (atomic):** bảng `code_counter(prefix, last_value)` — sinh trong transaction (`last_value+1`), zero-pad tối thiểu 2 chữ số (`NV01`, tràn `NV100`). KHÔNG dùng id thô (id có thể nhảy). Prefix cấu hình được (NV/KH/POS...).
- Migration cho user cũ (adminroot) → cấp mã `NV01` (hoặc mã hệ thống riêng). Đối chiếu unique khi import dữ liệu 991 POS/163 user cũ.
- **Regression:** test "mã sinh liên tục không trùng, không nhảy sai prefix, concurrent-safe trong 1 process".

## ĐỀ XUẤT ĐƯA VÀO ROADMAP (sửa IMS_SPEC §22)
| Phase | Nội dung (cập nhật) |
|-------|---------------------|
| G1 | Auth/Role/User/Audit/Backup (đang đóng .exe) |
| **G-POS** (mới, ưu tiên cao vì lõi GLOBEWAY) | Thư viện POS/TID event-sourced + lịch sử + TID chưa giao + push |
| G4 | **Thu chi** (sau nghiên cứu thị trường) |
| G8 | Report/Excel/PDF |
| G10 | VPS + PostgreSQL sync |

## CẦN Mr.Long QUYẾT
1. Duyệt kiến trúc **event-sourcing** cho POS/TID? (khuyến nghị — chuẩn vàng cho asset lifecycle).
2. Cho em **chạy deep-research thị trường thu chi** (web) không?
3. Thứ tự: đóng nốt **.exe G1 trước** rồi làm **G-POS**, hay ưu tiên G-POS luôn?
