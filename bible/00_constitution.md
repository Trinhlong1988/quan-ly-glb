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

## R_PROCESS_FEATURE_GATE + R_UI_DESKTOP_CONSISTENT — LEAD lock 9/7
Build **từng tính năng** → CMD_AUDIT review + chạy pass (build + screenshot/click thật, 0 lỗi console) → commit → mới sang tính năng kế. CẤM gộp nhiều tính năng chưa review. UI mọi màn dùng **1 design-system nhất quán như app .exe** (sidebar navy · brand `#1657D0` · card · table · FilterBar · Modal/ConfirmDialog · toast · Be Vietnam Pro).
