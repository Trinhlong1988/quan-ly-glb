# Quy ước lưu & đặt tên file đính kèm (LEAD lock 9/7)

> Áp cho mọi phần có tải ảnh: TK nhận tiền (CCCD), Hồ sơ HKD (ĐKKD + CCCD). Ảnh: PNG/JPG/PDF.

## Nơi lưu
- Thư mục gốc: `<userData>/uploads/` (cạnh `glb.db`). Mỗi bản ghi 1 thư mục con: `uploads/<loại>/<id>/`.
- DB chỉ lưu **đường dẫn tương đối + tên gốc + checksum + kích thước**. KHÔNG lưu nhị phân trong DB.
- **Sao lưu:** thư mục `uploads/` được gộp vào backup zip cùng `glb.db` (khôi phục phải khôi phục cả 2).

## Tên file (đóng bộ — "bộ nào vào bộ đấy")
Mỗi bộ = 1 chủ thể. Tên theo mẫu, `<Tên>` = tên chủ hộ (CCCD) hoặc tên HKD (ĐKKD):

| Loại | Mặt | Tên file |
|---|---|---|
| CCCD | Trước | `1. CCCD MT - <Tên chủ hộ>.<ext>` |
| CCCD | Sau | `2. CCCD MS - <Tên chủ hộ>.<ext>` |
| ĐKKD | Trước | `1. ĐKKD MT - <Tên HKD>.<ext>` |
| ĐKKD | Sau | `2. ĐKKD MS - <Tên HKD>.<ext>` |

## Quy tắc
- **Mặt sau KHÔNG bắt buộc.** Chỉ có mặt trước → dùng mặt trước, hợp lệ.
- Mặt trước là tối thiểu để coi là "có ảnh"; thiếu cả 2 = chưa đính kèm.
- Tên có dấu tiếng Việt giữ nguyên; ký tự không hợp lệ trên Windows (`\ / : * ? " < > |`) thay bằng khoảng trắng.
- Ghi đè cùng mặt = thay ảnh mới (audit lại), ảnh cũ chuyển vào `uploads/_trash/` (không xóa cứng — R_AUDIT_TRAIL).
