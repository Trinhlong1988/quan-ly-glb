# SỔ HẠNG MỤC HOÃN — chống "duyệt gộp chôn việc lớn" (hardlock quy trình)

> **Vì sao có sổ này:** 10/7 Mr.Long phát hiện **auto-update .exe bị bỏ sót**. Truy vết: `PHASE_G10_DEPLOYMENT_SPEC.md` Q5 = *"HOÃN — cài tay bản mới"* do **LEAD tự đặt mặc định** rồi **gộp vào lô "chốt Q1–Q6"**. Mr.Long gật cả cụm → một hạng mục LỚN (đụng triển khai đa máy) bị chôn trong lô duyệt, không được quyết riêng. Đây là **process-failure**, ghi `BUGS_FIXED.md` (PF-01).

## LUẬT (áp dụng mọi spec dự án này)
1. **Mọi ô/dòng ghi `HOÃN` / `TODO` / `tạm` / `sau này`** trong bất kỳ file `docs/*_SPEC.md` **PHẢI** có 1 dòng tương ứng trong bảng dưới (id + việc + lý do hoãn + điều kiện mở lại). Guard sẽ soi.
2. **CẤM gói ≥2 quyết định lớn vào 1 lời "chốt".** Việc đụng **hạ tầng / đa máy / bảo mật / dữ liệu** phải hỏi **1 câu riêng**, Mr.Long duyệt riêng — không nhét mặc định vào lô.
3. LEAD rà sổ này **mỗi lần mở frame mới** — hạng mục nào tới điều kiện mở lại thì đưa vào pipeline, không để trôi.

## Bảng hạng mục hoãn
| id | Việc | Nguồn | Lý do hoãn | Điều kiện mở lại | Trạng thái |
|---|---|---|---|---|---|
| D01 | **Auto-update .exe tích hợp trong app** | G10 Q5 | (SAI) LEAD tự mặc định HOÃN, gộp lô chốt | Mr.Long yêu cầu 10/7 | 🔄 **ĐANG BUILD** (G11) — huỷ trạng thái hoãn |
| D02 | Ký số chứng chỉ (code-signing) .exe | G11 phản biện | Chưa mua chứng chỉ; nội bộ tạm chấp nhận SmartScreen | Khi có chứng chỉ / phát hành ngoài LAN | ⏳ hoãn (Mr.Long biết) |
| D03 | Nâng cấp DB lên VPS | IMS_SPEC §định hướng | Giai đoạn sau, hiện chạy LAN | Khi cần truy cập ngoài văn phòng | ⏳ hoãn |

## Guard
`tools/audit/deferred_guard.mjs` (thêm vào `verify` + pre-commit): quét mọi `docs/*_SPEC.md` tìm token HOÃN/TODO/tạm → mỗi chỗ phải khớp 1 id trong bảng trên; thiếu → exit 1 (buộc khai báo, không cho hoãn ngầm).
