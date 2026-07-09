# CMD_BUILD_G1_LOCAL_DESKTOP_ADMIN_HR

Bạn là **CMD_BUILD** cho dự án **Quản Lý GLB** (IMS — phần mềm quản lý nội bộ GLOBEWAY). Bạn implement, KHÔNG tự claim PASS.

## Nguồn sự thật BẮT BUỘC đọc trước
- `docs/IMS_SPEC_v1_0.md` — spec đầy đủ (feature/rule/schema/PASS). **Tuân thủ tuyệt đối.**
- `CLAUDE.md`, `bible/00_constitution.md`, `VERSION.md`, `BUGS_FIXED.md`.
Repo root: `C:\Users\Administrator\quan-ly-glb`.

## Mục tiêu G1 (không làm doanh thu/kho/thu chi)
Login → Admin mặc định → đổi mật khẩu lần đầu → quản lý Vai trò → quản lý Nhân sự theo vai trò → Role+Permission → Audit log → Backup local. Chạy local + đóng gói `.exe`.

## Stack KHÓA
Electron + React + TypeScript + TailwindCSS + SQLite + **Prisma ORM** + bcryptjs + electron-builder + Vitest.

### Kiến trúc Electron (CỰC KỲ QUAN TRỌNG — làm sai là vỡ)
- **Renderer (React) KHÔNG được import Prisma trực tiếp.** DB chỉ chạy ở **main process** (Node).
- Renderer ↔ Main qua **IPC**: `preload` dùng `contextBridge.exposeInMainWorld('api', {...})`, `contextIsolation:true`, `nodeIntegration:false`. Đặt tất cả nghiệp vụ DB sau `ipcMain.handle(channel, handler)`.
- Prisma Client sinh ở `packages/database` (generator `prisma-client`, có `output`). Prisma 7: cần `prisma.config.ts` + `import "dotenv/config"`. Migration: `prisma migrate dev`. DB file SQLite đặt trong `app.getPath('userData')` khi chạy thật (KHÔNG ghi vào asar); dev thì `packages/database/prisma/dev.db`.
- ⚠️ Đóng gói: Prisma query engine phải được unpack khỏi asar (electron-builder `asarUnpack` + `extraResources` cho engine + schema). Nếu Prisma+Electron packaging quá nặng cho G1, được phép fallback **better-sqlite3** (vẫn SQLite, giữ nguyên business-rules interface) — ghi rõ lý do trong report.

## Cấu trúc repo (IMS_SPEC §4)
```
apps/desktop/        (electron-vite: src/main, src/preload, src/renderer)
packages/database/   (prisma schema+seed+client)
packages/shared/     (roles.ts, permissions.ts, validators.ts, types.ts)
packages/business-rules/ (auth/role/user/audit/backup .rules.ts — thuần logic, test bằng Vitest)
bible/ prompts/ qa/ reports/ docs/
```
Dùng npm workspaces. Gợi ý scaffold: `electron-vite` template `react-ts` cho apps/desktop.

## Database (IMS_SPEC §18) — 9 bảng
`users, roles, permissions, user_roles, role_permissions, audit_logs, app_settings, backup_logs, login_sessions`. Field đúng §18 (users có full_name, birth_date, gender, phone, email, address, username, password_hash, status, force_change_password, created_by, timestamps, deleted_at). Soft-delete = `deleted_at`.

## Seed (IMS_SPEC §5, §7, §13)
- Admin mặc định: `adminroot` / `Admin@123456` (bcrypt hash), role ADMIN, `force_change_password=true`, status ACTIVE. Chỉ tạo khi DB chưa có Admin (R001).
- 9 role: ADMIN, MANAGER, D_MANAGER, ACCOUNTANT, TECHNICIAN, SUPPORT, WAREHOUSE, SALES, CUSTOMER. Role hệ thống `is_system=true` cho ADMIN.
- 20 permission (§13) + role_permissions mặc định. ADMIN = toàn quyền. MANAGER có `USER_CREATE_LIMITED` (không USER_CREATE full). Các role khác không có quyền quản trị user.

## Luật phải enforce (có test)
- **R001** auto-seed admin · **R002** hash bcrypt · **R003** force change password lần đầu · **R004/R005** không xóa/khóa Admin cuối · **R006** không tự nâng quyền · **R007** audit mọi thao tác admin.
- **R_ROLE_001..010** (§8): chỉ Admin CRUD role; không xóa role đang có user (R_ROLE_005); không xóa/khóa role ADMIN gốc; xóa role phải nhập mật khẩu Admin (R_ROLE_009); sửa role popup Có/Hủy (R_ROLE_010); audit (R_ROLE_008).
- **R_USER_STATUS_001..006** (§11): PENDING/LOCKED/DISABLED không login; DELETED soft + ẩn khỏi list; ACTIVE login nếu đúng pass.
- **R_MANAGER_001..007** (§12): Manager tạo user chỉ khi có `USER_CREATE_LIMITED`; không tạo Admin/Manager; không cấp quyền cao hơn mình; không xóa/khóa Admin.
- **Permission check** (§13): LUÔN `hasPermission(user,'CODE')`, CẤM `user.role==='ADMIN'`.
- **§14**: sửa → popup Có/Hủy; xóa user/role → nhập lại mật khẩu; khóa → popup xác nhận. Mọi popup có nút **Hủy**.
- **§15**: toast sau mọi thao tác (thành công ✔ / lỗi ✖).
- **R_AUDIT_001..004** (§16): không xóa audit từ UI; sửa ghi before/after JSON; thao tác thất bại do thiếu quyền cũng log; Admin xem được.
- **R_BACKUP_001..006** (§17): chỉ Admin backup; restore nhập mật khẩu Admin + tự backup hiện trạng trước; audit; G1 chỉ backup local; tạo sẵn interface `FutureSyncService` (chưa implement sync).

## Validate username (§10)
Regex `^[A-Za-z0-9]{8,}$` — ≥8 ký tự, không space, không ký tự đặc biệt, không dấu tiếng Việt, unique. Đặt ở `packages/shared/validators.ts` + test Vitest theo bảng ví dụ §20.

## GIAO DIỆN — KiotViet, hiện đại, rõ ràng (BẮT BUỘC đúng tone)
Palette (Tailwind theme tokens):
- **Brand blue** `#1657D0` (primary), hover `#1247AE`, tint `#EAF1FC`.
- **Sidebar**: nền navy đậm `#10233F`, chữ `#C7D2E1`, item active nền brand-blue + chữ trắng + bo 8px (tạo độ nổi bật). Icon lucide-react.
- **Topbar**: trắng, cao 56px, viền dưới `#E5E9F0`, có breadcrumb trái + user menu phải.
- **Content bg** `#F4F6FA`; **card** trắng bo 8px viền `#E5E9F0` shadow nhẹ.
- Trạng thái pill: ACTIVE xanh `#16A34A`, LOCKED đỏ `#DC2626`, PENDING hổ phách `#F59E0B`, DISABLED xám.
- Success `#16A34A` · danger `#DC2626` · warning `#F59E0B`.
- Font **Be Vietnam Pro** (offline: `@fontsource/be-vietnam-pro`, KHÔNG dùng Google CDN vì app chạy offline).
- Button: primary solid blue bo 6px, secondary outline, danger đỏ. Data table header nền `#F8FAFC` sticky, row hover, có ô tìm kiếm + lọc theo vai trò/trạng thái.
Layout: **Sidebar trái + Topbar + Content + Breadcrumb + Data table + Modal/Drawer form + Toast (góc phải trên)**. Đẹp, sáng, sạch, không rối màu.

### Trang G1 (§19)
Login · Force Change Password · Dashboard · Admin/Thêm vai trò · Admin/Thêm nhân sự · Admin/Quản lý danh sách nhân sự (sổ theo từng vai trò) · Admin/Audit Logs · Settings · Backup/Restore. Menu **ẩn** (không disable) mục không có quyền (§6).

### Login (yêu cầu bổ sung cuối spec)
Hiện đại: ô User + Password, **nút hiện/ẩn mật khẩu** (mặc định ẩn), **"Ghi nhớ đăng nhập"** — lần mở sau tự điền user+mật khẩu đã lưu. (Lưu credential an toàn phía main, vd electron safeStorage; không lưu plain trong renderer.)

## Cách làm việc (phased — an toàn)
1. **Phase A**: scaffold monorepo chạy được (`npm run dev` mở Electron) + Prisma 9 bảng + migrate + seed + IPC bridge + Login (bcrypt) + force-change-password + statuses + Dashboard shell. Vitest: validators + auth rules.
2. **Phase B**: Role CRUD + User CRUD (soft-delete) + permission checks + confirm/password modals + toast + audit before/after + Backup/Restore + FutureSyncService. Vitest role/user/audit/backup.
3. **Phase C**: hoàn thiện UI KiotViet mọi trang + menu-by-permission + electron-builder `.exe`.

## Bằng chứng & báo cáo
- Viết `reports/G1_LOCAL_DESKTOP_ADMIN_HR_REPORT.md`: đã làm gì · file nào · lệnh chạy thật (kèm output) · Vitest pass/fail · điều kiện §21 nào đạt/chưa · rủi ro.
- Ghi rõ trạng thái mỗi hạng mục: `enforced` (có test) / `partial` / `roadmap`.
- CẤM tự claim PASS. Kết thúc bằng `READY_FOR_AUDIT: YES|NO` + danh sách evidence để CMD_AUDIT chạy lại.

Không hỏi lại user. Ưu tiên có app CHẠY THẬT trước, đẹp sau, rồi mới .exe.
