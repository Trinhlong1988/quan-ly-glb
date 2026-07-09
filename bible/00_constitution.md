# HIẾN PHÁP — Quản Lý GLB (bible/00)

Nguồn rule chi tiết: `docs/IMS_SPEC_v1_0.md`. File này = governance + index.

## Index rule (theo IMS_SPEC)
| Nhóm | Vị trí spec | Rule |
|------|-------------|------|
| Auth/Admin | §5 | R001–R007 |
| Role | §8 | R_ROLE_001–010 |
| User status | §11 | R_USER_STATUS_001–006 |
| Manager scope | §12 | R_MANAGER_001–007 |
| Permission | §13 | check bằng permission, không bằng role |
| Xác nhận thao tác | §14 | popup + nhập lại mật khẩu khi xóa |
| Audit | §16 | R_AUDIT_001–004 |
| Backup | §17 | R_BACKUP_001–006 |
| DB schema | §18 | 9 bảng |
| UI/UX | §19 | sidebar/topbar/toast/modal |
| Test gate | §20 | auth/username/role/user/audit/backup |
| PASS G1 | §21 | 18 điều kiện |

## Authority Matrix
| Vai | Quyền | Cấm |
|-----|-------|-----|
| LEAD (Mr.Long) | duyệt scope · ký PASS · freeze · tag · push | — |
| CMD_BUILD | implement trong scope · chạy test/build · viết G1 report | tự claim PASS · tự tag · giấu lỗi · đổi scope |
| CMD_AUDIT (Claude) | verify độc lập · mutation test · phát verdict · viết audit report | sửa code tính năng cho "xanh" · tin report builder không tự chạy lại |

## Chuỗi gate
```
CMD_BUILD → READY_FOR_AUDIT:YES + evidence
  → CMD_AUDIT chạy lại test gate §20 + PASS §21 + mutation battery
     PASS → LEAD nghe/chạy thật → ký → push repo
     FAIL → trả CMD_BUILD kèm bằng chứng
```
Exit code: `0`=PASS · `1`=FAIL · `2`=BLOCKED.

## Nguyên tắc chống overclaim
Mọi trạng thái ghi rõ: `enforced` (có test/tool cưỡng chế) / `partial` / `roadmap`. Cấm ghi "done/100%/PASS" cho hạng mục chưa có bằng chứng chạy thật. Dùng "Engineering PASS / Ready for Production Validation".

## R_AUDIT_TRAIL — LEAD lock 9/7 (TỐI THƯỢNG)
**Mọi thao tác/sửa đổi dữ liệu trong app PHẢI ghi audit log realtime + log KHÔNG xóa được (không có endpoint xóa).** App **CẤM tự ý hoàn tác/thay đổi dữ liệu âm thầm** — không seed/migration/scheduler/re-sync nào được thay dữ liệu người dùng đã chỉnh mà không (a) do người dùng chủ động, hoặc (b) ghi audit rõ ràng. Vi phạm điển hình đã fix: G-POS-A01 (seed hoàn quyền admin). Áp mọi feature G1..Gn.

## R_LINK_VERIFY — LEAD lock 9/7 (TỐI THƯỢNG cho mọi tính năng có liên kết)
Mọi tính năng có liên kết dữ liệu PHẢI thỏa 6 điều trước khi qua gate:
1. **Xác thực đúng phương thức liên kết**: khai rõ mỗi trường link là FK-cứng(+cascade?)/scalar-id/join-table/IPC-channel. Không mơ hồ.
2. **Không chồng chéo**: mỗi quan hệ có 1 chiều quản lý authoritative; không 2 nơi cùng sửa 1 sự thật.
3. **Tường minh từng dòng code, từng trường**: bảng liên kết field-by-field trong report.
4. **Phản biện đúng/sai**: nêu cả case đúng lẫn case sai kỳ vọng.
5. **Kiểm thử 50 ĐÚNG + 50 SAI**: bộ test tối thiểu 50 hợp lệ (phải PASS) + 50 sai (phải bị chặn đúng lý do), chạy thật, **dán bằng chứng số liệu**.
6. **Kiểm soát độc lập**: CMD_AUDIT tự chạy lại, không tin report builder.

## R_DATE_FORMAT — LEAD lock 9/7
Mọi hiển thị ngày = **dd/mm/yyyy** (dd, mm đủ 2 chữ số: 01,02…). Cột dữ liệu có thời điểm PHẢI **tách 2 cột: Ngày | Giờ** (giờ HH:mm:ss). Dùng util chung `@glb/shared` (`fmtDate`/`fmtTime`), cấm `toLocaleString` tự do.

## R_BUTTON_SEMANTICS — LEAD lock 9/7
Màu nút theo ngữ nghĩa: **Sửa = vàng** · **Thực hiện/Xác nhận/Lưu = xanh** · **Xóa = đỏ** · nút phụ (Hủy/Làm mới) = xám viền. Dialog báo thao tác SAI phải **TO, RÕ RÀNG** (nổi bật, icon cảnh báo, không toast nhỏ dễ lướt qua).

## R_TRASH_RESTORE — LEAD lock 9/7
Soft-delete toàn hệ thống: xóa = đánh dấu trạng thái "đã xóa" + vào **Thùng rác**, KHÔNG xóa vật lý. Xóa thực thể **có liên kết** → dialog cảnh báo rõ (liệt kê cái đang liên kết). **Admin có quyền phục hồi** từ thùng rác. Xóa user KHÔNG ảnh hưởng dữ liệu user đã tạo (scalar `createdBy`, không cascade).

## R_PROCESS_FEATURE_GATE + R_UI_DESKTOP_CONSISTENT — LEAD lock 9/7
Build **từng tính năng** → CMD_AUDIT review + chạy pass (build + screenshot/click thật, 0 lỗi console) → commit → mới sang tính năng kế. CẤM gộp nhiều tính năng chưa review. UI mọi màn dùng **1 design-system nhất quán như app .exe** (sidebar navy · brand `#1657D0` · card · table · FilterBar · Modal/ConfirmDialog · toast · Be Vietnam Pro).

## R_UI_STANDARD — LEAD lock 9/7 (TỐI THƯỢNG, cấm làm lệch)
**Nguồn chuẩn = `docs/UI_DESIGN_SYSTEM.md`.** Mọi thành phần cùng vai trò (tiêu đề/header bảng/ô dữ liệu/nhãn/nút/badge) PHẢI **giống hệt nhau ở mọi trang**: cùng font (Be Vietnam Pro), cùng cỡ chữ theo thang vai trò, cùng quy tắc đậm/hoa/thường logic, cùng màu palette, cùng component dùng chung. **CẤM tự ý làm lệch** — không `text-[..px]` tùy tiện, không hex ngoài palette, không tự chế button/dialog mới, không font khác. Mỗi lỗi lệch = **thất bại QA** (R_LINK_VERIFY tinh thần). QA gate UI (mục 8 design system) BẮT BUỘC trước khi PASS bất kỳ màn nào. Áp mọi feature G1..Gn.
