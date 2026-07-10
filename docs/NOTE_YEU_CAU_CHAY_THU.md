# NOTE — YÊU CẦU CHẠY THỬ PRODUCTION (gửi LEAD / Mr.Long)

> **R196:** Engineering PASS ≠ Production PASS. Các module dưới đây đã đạt **L1 Engineering Validation PASS**
> (typecheck + build + selftest chạy thật, số liệu thật). **CHƯA** nghiệm thu Production —
> cần ≥1 lần chạy thật trên máy + LEAD chấp nhận bằng mắt thì mới coi là hoàn tất.
> Ngày: 2026-07-10 · CMD_BUILD (Claude).

## 1. Đã build phiên này (chờ chạy thử)

| Module | Trạng thái Engineering | Bằng chứng |
|---|---|---|
| **Doanh thu** (bóc 2 khoản chênh cộng gộp) | L1 PASS | REV15 **43/0** |
| **Công nợ** (2 khoản đối tác+khách, đối soát) | L1 PASS | REV15 **43/0** |
| **Storage-Guard** (chống tràn, cảnh báo 80%, dọn an toàn, backup ngày) | L1 PASS | STG16 **33/0** |
| **Bảo trì định kỳ** (chọn thứ+giờ, bật/tắt, VACUUM) | L1 PASS | STG16 **33/0** |
| **Health-Scan** (quét toàn hệ thống + đề xuất fix + tự sửa + lịch sử) | L1 PASS | HSC17 **22/0** (nhồi 7 loại dữ liệu sai) |

Nền chung: typecheck main+web **0 lỗi** · build **0** · fresh-deploy migration mới **16/0** · vitest **193/193** · thùng rác **106/0**.
Đang có **3 agent phản biện độc lập** kiểm định (doanh thu · an toàn dữ liệu · bảo mật) — kết quả sẽ bổ sung.

## 2. Cách chạy app để LEAD nghiệm thu

```
cd C:\Users\Administrator\quan-ly-glb
npm run --workspace @glb/desktop dev      # mở app dev (hoặc build .exe khi chốt)
```
Đăng nhập: `adminroot` / `Admin@123456` (lần đầu app ép đổi mật khẩu).

## 3. Kịch bản chạy thử ĐỀ NGHỊ (đánh dấu Đạt/Không cho từng mục)

### A. Doanh thu & Công nợ
1. Cấu hình sẵn: 1 Ngân hàng + 1 Loại thẻ + 1 Đối tác (liên kết NH) + Biểu phí (phí mua/cài máy/bán) + 1 TID gắn đối tác.
2. **Quản Lý Doanh Thu → Ghi nhận giao dịch**: chọn TID, loại thẻ, nhập số tiền, ngày → Lưu.
   - ✔ Kiểm: cột **Chênh đối tác** = tiền×(phíMua−phíCàiMáy)%, **Chênh bán** = tiền×(phíBán−phíCàiMáy)%, **Doanh thu** = tổng 2 khoản.
3. Đổi biểu phí → ghi nhận: doanh thu **giao dịch cũ KHÔNG đổi** (snapshot).
4. Lọc theo MID / HKD / khách / ngân hàng / đối tác / khoảng ngày → KPI tổng cập nhật đúng.
5. **Quản Lý Công Nợ**: giao dịch chưa đối soát hiện ở đây, tổng nợ = nợ đối tác + nợ khách. Tick chọn → **Đánh dấu đã thu** → công nợ giảm.

### B. Bảo trì & chống tràn bộ nhớ
6. **Bảo Trì Hệ Thống**: xem % ổ đĩa + dung lượng DB + backup gần nhất.
7. **Quét ngay** → xem báo cáo lỗi/cảnh báo + **đề xuất fix**. **Quét & Tự sửa** → doanh thu lệch (nếu có) được tính lại.
8. **Lịch sử bảo trì**: mỗi lần quét/bảo trì lưu 1 dòng (thời gian, kết quả, số lỗi, đã dọn, người/nguồn).
9. **Cấu hình bảo trì**: đặt ngưỡng cảnh báo, hạn lưu nhật ký/thùng rác, chu kỳ backup; **Bảo trì định kỳ**: chọn **thứ trong tuần + giờ**, bật/tắt tự động, tự dọn dữ liệu quá hạn.
10. **Dọn dẹp**: chọn Nhật ký cũ / Thùng rác cũ → nhập mật khẩu → hệ thống **tự backup trước** rồi mới xóa (báo số dòng đã dọn + đã backup).
11. Khi ổ đĩa vượt ngưỡng → **dialog cảnh báo** hiện ra yêu cầu dọn dẹp.

## 4. Việc CÒN LẠI (chưa làm trong phiên này — chờ LEAD ưu tiên)
- Chạy `.exe` đóng gói (electron-builder) để nghiệm thu như bản phát hành.
- Nhóm C (hòm thư người dùng — đã có nền, cần rà UX).
- Nhóm F (con trỏ xoay, đồng bộ icon), báo cáo tài nguyên realtime, chiến dịch test 100 đúng/100 sai.
- **Sau khi LEAD chạy thử & chấp nhận** → nâng trạng thái từ *L1 Engineering PASS* lên *L2 Production PASS*, ghi VERSION.md, cân nhắc freeze + git tag.

## 5. Yêu cầu LEAD
> Xin Mr.Long **chạy thử theo mục 3** và cho biết Đạt/Không từng mục (đặc biệt công thức doanh thu 2 khoản + an toàn dọn dẹp). Chỉ khi LEAD chấp nhận, module mới được coi là hoàn tất (R196). Nếu phát hiện lỗi khi chạy thật → coi là **thất bại quy trình test**, sẽ bổ sung regression trước khi sửa.
