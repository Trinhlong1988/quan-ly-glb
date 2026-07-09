# IMS SPEC v1.0 — Phần mềm quản lý nội bộ doanh thu, kho, thu chi

**Tên dự án tạm:** Internal Management System / IMS  
**Định hướng:** Desktop-first, chạy local, đóng gói file `.exe`, có khả năng backup và nâng cấp lên VPS sau này.  
**Phong cách quản trị:** giống mô hình Hắc Dạ Ký Studio: có spec, luật, phân vai, phản biện, test gate, audit log, không tự nhận PASS khi chưa có bằng chứng.

---

## 1. Mục tiêu G1

G1 chỉ tập trung xây dựng nền móng phần mềm:

1. Chạy local trên Windows.
2. Đóng gói được thành file cài đặt `.exe`.
3. Có giao diện đẹp, sáng, dễ dùng, lấy cảm hứng từ KiotViet/POS Việt Nam nhưng không sao chép.
4. Có tài khoản Admin mặc định quyền cao nhất.
5. Admin đăng nhập mới được tạo vai trò, tạo nhân sự, quản lý danh sách nhân sự.
6. Manager được phép tạo user theo phạm vi giới hạn.
7. Các vai trò còn lại không được tạo hoặc xóa user.
8. Có hệ thống Role + Permission rõ ràng.
9. Có audit log cho mọi thao tác quan trọng.
10. Có backup local để sau này đưa lên VPS/PostgreSQL.

G1 **không làm** doanh thu, kho, thu chi. Các module này sẽ làm sau khi nền tài khoản/phân quyền đã khóa.

---

## 2. Kiến trúc triển khai

```text
Windows Desktop App (.exe)
        │
        ▼
Electron + React + TypeScript
        │
        ▼
SQLite Local Database
        │
        ▼
Local Backup / Restore
        │
        ▼
Future Sync Layer
        │
        ▼
VPS + PostgreSQL
```

### 2.1. Lý do chọn kiến trúc này

- Người dùng cài như phần mềm máy tính bình thường.
- Chạy được offline, không phụ thuộc Internet.
- Dữ liệu giai đoạn đầu nằm local trong SQLite.
- Sau này có thể backup, restore hoặc sync lên VPS.
- Business logic giữ nguyên khi chuyển từ SQLite sang PostgreSQL.

---

## 3. Stack kỹ thuật G1

| Hạng mục | Công nghệ |
|---|---|
| Desktop app | Electron |
| UI | React + TypeScript |
| CSS | TailwindCSS |
| Database local | SQLite |
| ORM | Prisma |
| Password hash | bcrypt |
| Build EXE | electron-builder |
| Test | Vitest |
| UI test sau này | Playwright |
| Backup | copy/zip SQLite database |
| Future server | VPS + PostgreSQL |

---

## 4. Cấu trúc repo đề xuất

```text
internal-management-system/
  apps/
    desktop/
      src/
        main/
        renderer/
          app/
            login/
            dashboard/
            admin/
              roles/
              staff/
              audit-logs/
              settings/
          components/
            layout/
            ui/
            forms/
            tables/
          styles/
        preload/
      electron-builder.yml
      package.json

  packages/
    database/
      prisma/
        schema.prisma
        seed.ts
      src/
        client.ts
        migrations/

    shared/
      src/
        roles.ts
        permissions.ts
        validators.ts
        types.ts

    business-rules/
      src/
        auth.rules.ts
        role.rules.ts
        user.rules.ts
        audit.rules.ts
        backup.rules.ts

  bible/
    00_constitution.md
    01_auth_rules.md
    02_permission_matrix.md
    03_user_role_rules.md
    04_backup_restore_rules.md
    05_ui_rules.md

  prompts/
    CMD_BUILD_G1_LOCAL_DESKTOP_ADMIN_HR.md
    CMD_AUDIT_G1_LOCAL_DESKTOP_ADMIN_HR.md
    CMD_FIX_G1_LOCAL_DESKTOP_ADMIN_HR.md
    CMD_LOCK_G1_LOCAL_DESKTOP_ADMIN_HR.md

  qa/
    auth/
    role/
    user/
    backup/
    security/

  reports/
    G1_LOCAL_DESKTOP_ADMIN_HR_REPORT.md
    G1_AUDIT_REPORT.md
```

---

## 5. Tài khoản Admin mặc định

Khi chạy lần đầu, hệ thống tự tạo tài khoản Admin mặc định.

```text
username: adminroot
password: Admin@123456
role: ADMIN
force_change_password: true
status: ACTIVE
```

### Luật bắt buộc

```text
R001: Hệ thống phải tự tạo Admin mặc định khi database chưa có Admin.
R002: Password Admin mặc định phải được hash bằng bcrypt.
R003: Admin mặc định phải bắt buộc đổi mật khẩu sau lần đăng nhập đầu tiên.
R004: Không được xóa Admin cuối cùng.
R005: Không được khóa Admin cuối cùng.
R006: Không user nào được tự nâng quyền chính mình.
R007: Mọi thao tác Admin phải ghi audit log.
```

---

## 6. Menu giao diện G1

Sidebar chính:

```text
Dashboard

Admin
 ├─ Thêm mới vai trò
 ├─ Thêm mới nhân sự
 └─ Quản lý danh sách nhân sự
      ├─ Admin
      ├─ Manager
      ├─ D Manager
      ├─ Kế toán
      ├─ Kỹ thuật
      ├─ Support
      ├─ Kho
      ├─ Sales
      ├─ Khách hàng
      └─ Vai trò custom

Nhật ký hệ thống
Cài đặt
Backup / Restore
Đăng xuất
```

### Hiển thị menu theo quyền

- Admin thấy toàn bộ menu.
- Manager thấy menu nhân sự theo quyền được cấp.
- D Manager, Kế toán, Kỹ thuật, Support, Kho, Sales, Khách hàng chỉ thấy menu được cấp quyền.
- Menu không có quyền thì ẩn, không chỉ disable.

---

## 7. Vai trò mặc định

| Role | Mã | Quyền mặc định |
|---|---|---|
| Admin | ADMIN | Toàn quyền |
| Manager | MANAGER | Tạo user giới hạn, xem/sửa theo phân quyền |
| D Manager | D_MANAGER | Xem/duyệt giới hạn, không tạo/xóa user |
| Kế toán | ACCOUNTANT | Thu chi, công nợ, báo cáo sau này |
| Kỹ thuật | TECHNICIAN | Kỹ thuật, bảo hành, hỗ trợ vận hành |
| Support | SUPPORT | Hỗ trợ khách hàng |
| Kho | WAREHOUSE | Nhập/xuất/tồn kho sau này |
| Sales | SALES | Bán hàng, khách hàng sau này |
| Khách hàng | CUSTOMER | Tài khoản khách hàng, quyền rất giới hạn |

Admin có thể tạo thêm vai trò mới.

---

## 8. Quản lý vai trò

Menu:

```text
Admin → Thêm mới vai trò
Admin → Quản lý vai trò
```

### Form thêm mới vai trò

| Trường | Bắt buộc | Ghi chú |
|---|---:|---|
| Tên vai trò | Có | Ví dụ: Marketing |
| Mã vai trò | Có | Không dấu, không khoảng trắng |
| Mô tả | Không | Mô tả phạm vi quyền |
| Trạng thái | Có | Active / Locked |
| Permission | Có | Chọn quyền cho vai trò |

### Chức năng vai trò

```text
Tạo mới vai trò
Sửa vai trò
Khóa vai trò
Mở khóa vai trò
Xóa vai trò
Gán permission cho vai trò
```

### Luật vai trò

```text
R_ROLE_001: Chỉ Admin được tạo vai trò.
R_ROLE_002: Chỉ Admin được sửa vai trò.
R_ROLE_003: Chỉ Admin được khóa/mở khóa vai trò.
R_ROLE_004: Chỉ Admin được xóa vai trò.
R_ROLE_005: Không được xóa role đang có user sử dụng.
R_ROLE_006: Không được xóa role ADMIN gốc.
R_ROLE_007: Không được khóa role ADMIN gốc.
R_ROLE_008: Mọi thay đổi role phải ghi audit log.
R_ROLE_009: Xóa role phải yêu cầu nhập lại mật khẩu Admin.
R_ROLE_010: Sửa role phải có popup xác nhận Có/Hủy.
```

---

## 9. Quản lý nhân sự / User

Menu:

```text
Admin → Thêm mới nhân sự
Admin → Quản lý danh sách nhân sự
```

### Form tạo mới nhân sự

| Trường | Bắt buộc | Ghi chú |
|---|---:|---|
| Họ và tên | Có | Tên nhân sự |
| Ngày tháng năm sinh | Có | dd/mm/yyyy |
| Giới tính | Không | Nam/Nữ/Khác |
| Số điện thoại | Có | Dùng để liên hệ |
| Email | Có | Không được trùng |
| Địa chỉ | Không | Có thể bổ sung sau |
| User đăng nhập | Có | Theo quy tắc username |
| Mật khẩu | Có | Hash bcrypt |
| Vai trò | Có | Ít nhất 1 vai trò |
| Trạng thái tài khoản | Có | Active / Pending |
| Ngày vào làm | Không | Dùng cho HR sau này |

---

## 10. Quy tắc User đăng nhập

User đăng nhập phải tuân thủ:

```text
Tối thiểu 8 ký tự
Không chứa khoảng trắng
Không chứa ký tự đặc biệt
Không chứa dấu tiếng Việt
Chỉ cho phép chữ A-Z, a-z và số 0-9
Không được trùng user đã tồn tại
```

Regex:

```regex
^[A-Za-z0-9]{8,}$
```

### Hợp lệ

```text
nguyenvana
ketoan001
manager01
support01
```

### Không hợp lệ

```text
nguyen van a
admin@01
kt-001
abc123
kếtoan001
```

---

## 11. Trạng thái User

G1 hỗ trợ tối thiểu:

```text
ACTIVE: Đã kích hoạt
PENDING: Chưa kích hoạt
LOCKED: Đã khóa
DISABLED: Ngưng sử dụng
DELETED: Đã xóa mềm
```

### Luật trạng thái

```text
R_USER_STATUS_001: User PENDING chưa được đăng nhập.
R_USER_STATUS_002: User ACTIVE được đăng nhập nếu password đúng.
R_USER_STATUS_003: User LOCKED không được đăng nhập.
R_USER_STATUS_004: User DISABLED không được đăng nhập.
R_USER_STATUS_005: User DELETED không hiển thị mặc định trong danh sách.
R_USER_STATUS_006: Xóa user là soft delete, không xóa vật lý khỏi database.
```

---

## 12. Phân quyền tạo/xóa User

### Quyền theo vai trò

| Vai trò | Tạo user | Xóa user | Sửa user | Khóa user | Ghi chú |
|---|---:|---:|---:|---:|---|
| Admin | Có | Có | Có | Có | Toàn quyền |
| Manager | Có giới hạn | Có giới hạn hoặc không | Có giới hạn | Có giới hạn | Không được tạo Admin/Manager |
| D Manager | Không | Không | Không hoặc giới hạn | Không hoặc giới hạn | Tùy Admin cấp quyền |
| Kế toán | Không | Không | Không | Không | Mặc định không quản lý user |
| Kỹ thuật | Không | Không | Không | Không | Mặc định không quản lý user |
| Support | Không | Không | Không | Không | Mặc định không quản lý user |
| Kho | Không | Không | Không | Không | Mặc định không quản lý user |
| Sales | Không | Không | Không | Không | Mặc định không quản lý user |
| Khách hàng | Không | Không | Không | Không | Quyền thấp nhất |

### Luật Manager

```text
R_MANAGER_001: Manager được tạo user nếu có permission USER_CREATE_LIMITED.
R_MANAGER_002: Manager không được tạo Admin.
R_MANAGER_003: Manager không được tạo Manager khác.
R_MANAGER_004: Manager không được cấp quyền cao hơn chính mình.
R_MANAGER_005: Manager không được xóa Admin.
R_MANAGER_006: Manager không được khóa Admin.
R_MANAGER_007: Manager chỉ thao tác trong phạm vi role/department được Admin cấp.
```

---

## 13. Permission Matrix G1

Permission tối thiểu:

```text
DASHBOARD_VIEW
USER_CREATE
USER_CREATE_LIMITED
USER_READ
USER_UPDATE
USER_DELETE
USER_LOCK
USER_UNLOCK
ROLE_CREATE
ROLE_READ
ROLE_UPDATE
ROLE_DELETE
ROLE_LOCK
ROLE_UNLOCK
ROLE_ASSIGN
AUDIT_LOG_VIEW
BACKUP_CREATE
BACKUP_RESTORE
SYSTEM_SETTING_VIEW
SYSTEM_SETTING_UPDATE
```

### Nguyên tắc

```text
Không check quyền bằng tên role trực tiếp.
Luôn check bằng permission.
Role chỉ là nhóm permission.
```

Sai:

```ts
if (user.role === 'ADMIN')
```

Đúng:

```ts
hasPermission(user, 'USER_CREATE')
```

---

## 14. Xác nhận thao tác

Mọi thao tác quan trọng đều phải có xác nhận.

### Sửa thông tin

```text
Popup:
Bạn có chắc muốn lưu thay đổi?
[Đồng ý] [Hủy]
```

### Xóa User

```text
Popup:
Hành động này sẽ xóa mềm tài khoản.
Vui lòng nhập mật khẩu xác nhận.
[Nhập mật khẩu]
[Xóa] [Hủy]
```

### Xóa Role

```text
Popup:
Bạn đang xóa vai trò. Không thể xóa nếu vai trò đang có nhân sự sử dụng.
Vui lòng nhập mật khẩu Admin.
[Xóa] [Hủy]
```

### Khóa User / Role

```text
Popup:
Bạn có chắc muốn khóa?
[Khóa] [Hủy]
```

---

## 15. Push Notification / Toast

Sau mỗi thao tác phải có thông báo.

Ví dụ:

```text
✔ Đã tạo nhân sự Nguyễn Văn A
✔ Đã cập nhật vai trò Manager
✔ Đã khóa tài khoản support001
✖ User đăng nhập không hợp lệ
✖ Không thể xóa role đang có 15 nhân sự sử dụng
```

---

## 16. Audit Log

Audit log là bắt buộc.

### Các hành động phải log

```text
LOGIN_SUCCESS
LOGIN_FAILED
USER_CREATED
USER_UPDATED
USER_LOCKED
USER_UNLOCKED
USER_DELETED
ROLE_CREATED
ROLE_UPDATED
ROLE_LOCKED
ROLE_UNLOCKED
ROLE_DELETED
PASSWORD_CHANGED
BACKUP_CREATED
RESTORE_EXECUTED
SETTING_UPDATED
```

### Trường audit log

| Trường | Ý nghĩa |
|---|---|
| id | ID log |
| actor_user_id | Ai thao tác |
| action | Hành động |
| target_type | User/Role/System |
| target_id | ID đối tượng |
| before_json | Dữ liệu trước |
| after_json | Dữ liệu sau |
| ip_address | Local/IP |
| device_info | Thông tin máy |
| created_at | Thời gian |

### Luật audit

```text
R_AUDIT_001: Không được xóa audit log từ giao diện.
R_AUDIT_002: Audit log phải ghi before/after với thao tác sửa.
R_AUDIT_003: Thao tác thất bại do không đủ quyền cũng phải log.
R_AUDIT_004: Audit log phải xem được bởi Admin.
```

---

## 17. Backup / Restore

Menu:

```text
Backup / Restore
 ├─ Tạo backup ngay
 ├─ Danh sách backup
 ├─ Restore từ backup
 └─ Cấu hình backup tự động
```

### Backup local

```text
backups/
  2026-07-09_093000_ims_backup.zip
  2026-07-09_120000_ims_backup.zip
```

Backup gồm:

```text
SQLite database
app_settings
backup_manifest.json
```

### Luật backup

```text
R_BACKUP_001: Admin mới được tạo backup.
R_BACKUP_002: Restore phải yêu cầu mật khẩu Admin.
R_BACKUP_003: Trước khi restore phải tự tạo backup hiện trạng.
R_BACKUP_004: Mỗi lần backup/restore phải ghi audit log.
R_BACKUP_005: G1 chỉ cần backup local, chưa cần sync VPS.
R_BACKUP_006: Phải thiết kế sẵn interface FutureSyncService để G10 dùng.
```

---

## 18. Database Schema G1

Bảng tối thiểu:

```text
users
roles
permissions
user_roles
role_permissions
audit_logs
app_settings
backup_logs
login_sessions
```

### users

```text
id
full_name
birth_date
gender
phone
email
address
username
password_hash
status
force_change_password
created_by
created_at
updated_at
deleted_at
```

### roles

```text
id
name
code
description
status
is_system
created_by
created_at
updated_at
deleted_at
```

### permissions

```text
id
code
name
description
group
created_at
```

### user_roles

```text
user_id
role_id
created_at
```

### role_permissions

```text
role_id
permission_id
created_at
```

### audit_logs

```text
id
actor_user_id
action
target_type
target_id
before_json
after_json
ip_address
device_info
created_at
```

### backup_logs

```text
id
file_path
file_size
checksum
created_by
created_at
note
```

---

## 19. UI/UX Rules

Giao diện theo hướng:

```text
Sáng
Sạch
Hiện đại
Dễ dùng
Bảng dữ liệu lớn
Nút thao tác rõ ràng
Popup xác nhận nhất quán
Không rối màu
```

### Layout

```text
Sidebar trái
Topbar trên
Content chính
Breadcrumb
Data table
Form drawer/modal
Toast notification
```

### Trang cần có ở G1

```text
Login
Force Change Password
Dashboard
Admin / Thêm mới vai trò
Admin / Thêm mới nhân sự
Admin / Quản lý danh sách nhân sự
Admin / Danh sách nhân sự theo vai trò
Admin / Audit Logs
Settings
Backup / Restore
```

---

## 20. Test Gate G1

### Auth test

```text
Login đúng Admin mặc định
Login sai password bị chặn
User LOCKED không đăng nhập được
User PENDING không đăng nhập được
Admin force_change_password phải đổi mật khẩu
```

### Username test

```text
nguyenvana → PASS
ketoan001 → PASS
manager01 → PASS
nguyen van a → FAIL
admin@01 → FAIL
kt-001 → FAIL
abc123 → FAIL
kếtoan001 → FAIL
```

### Role test

```text
Admin tạo role mới được
Admin sửa role được
Admin khóa role được
Admin mở khóa role được
Admin không xóa role ADMIN
Admin không xóa role đang có user
```

### User test

```text
Admin tạo user được
Manager tạo user giới hạn được
D Manager không tạo user nếu không có quyền
Support không tạo user
Kho không tạo user
Sales không tạo user
Khách hàng không tạo user
Không xóa Admin cuối cùng
Không khóa Admin cuối cùng
```

### Audit test

```text
Tạo user có audit log
Sửa user có audit log before/after
Xóa user có audit log
Tạo role có audit log
Khóa role có audit log
Login failed có audit log
```

### Backup test

```text
Admin tạo backup được
Backup sinh file trong backups/
Backup có checksum
Restore yêu cầu mật khẩu Admin
Restore tạo backup hiện trạng trước khi restore
```

---

## 21. Điều kiện PASS G1

G1 chỉ được PASS khi có bằng chứng:

```text
1. Chạy được local.
2. Build được file .exe.
3. Login được bằng adminroot.
4. Admin buộc đổi mật khẩu lần đầu.
5. Admin tạo được role mới.
6. Admin sửa/khóa/mở khóa role được.
7. Admin tạo được nhân sự mới.
8. Username validate đúng rule.
9. Manager chỉ tạo user trong phạm vi được cấp.
10. Các role khác không tạo/xóa user mặc định.
11. Danh sách nhân sự hiển thị theo từng vai trò.
12. Xóa user/role yêu cầu nhập mật khẩu.
13. Mọi thao tác có popup xác nhận và nút Hủy.
14. Mọi thao tác có toast notification.
15. Audit log hoạt động.
16. Backup local hoạt động.
17. Có báo cáo reports/G1_LOCAL_DESKTOP_ADMIN_HR_REPORT.md.
18. Có test report.
```

Không được tự claim PASS nếu chưa chạy test/build thật.

---

## 22. Roadmap tổng thể

| Giai đoạn | Nội dung |
|---|---|
| G1 | Local Desktop + Admin + Role + User + Backup |
| G2 | Department + Branch + Staff Profile mở rộng |
| G3 | Customer + Supplier |
| G4 | Sales / Doanh thu |
| G5 | Inventory / Kho |
| G6 | Cashflow / Thu chi |
| G7 | Debt / Công nợ |
| G8 | Report / Excel / PDF |
| G9 | Security nâng cao + Approval Workflow |
| G10 | VPS Sync + PostgreSQL + Multi-device |

---

## 23. Prompt Claude Code G1

```md
# CMD_BUILD_G1_LOCAL_DESKTOP_ADMIN_HR

Bạn là CMD_BUILD cho dự án phần mềm quản lý nội bộ doanh thu, kho, thu chi.

Mục tiêu G1:
Xây dựng phần mềm chạy local trước, đóng gói được file .exe cài máy Windows, có nền tảng Admin + Vai trò + Nhân sự + Backup local.

Không làm doanh thu, kho, thu chi ở bước này.
Chỉ làm:
1. App local desktop
2. Login
3. Admin mặc định
4. Đổi mật khẩu lần đầu
5. Thêm mới vai trò
6. Sửa/khóa/mở khóa/xóa vai trò
7. Thêm mới nhân sự
8. Quản lý danh sách nhân sự theo từng vai trò
9. Role + Permission
10. Audit log
11. Backup local database
12. Chuẩn bị interface để sau này sync VPS/PostgreSQL

Stack bắt buộc:
- Electron
- React
- TypeScript
- TailwindCSS
- SQLite local
- Prisma ORM
- bcrypt
- electron-builder
- Vitest

Yêu cầu khởi tạo:
Khi chạy lần đầu, hệ thống tự tạo tài khoản Admin mặc định:

username: adminroot
password: Admin@123456
role: ADMIN
force_change_password: true
status: ACTIVE

Luật bảo mật:
- Mật khẩu phải hash bằng bcrypt.
- Không lưu mật khẩu plain text.
- Chỉ ADMIN mới được tạo/sửa/khóa/mở khóa/xóa vai trò.
- Admin và Manager có thể tạo user, nhưng Manager bị giới hạn phạm vi.
- Các vai trò khác mặc định không được tạo/xóa user.
- Không được khóa Admin cuối cùng.
- Không được xóa Admin cuối cùng.
- Không user nào được tự nâng quyền chính mình.
- Xóa user/role phải yêu cầu nhập lại mật khẩu.
- Sửa user/role phải có popup xác nhận Có/Hủy.
- Mọi thao tác quan trọng phải có toast notification.
- Mọi thao tác tạo/sửa/xóa/khóa/mở phải ghi audit log.

Menu bắt buộc:

Admin
- Thêm mới vai trò
- Thêm mới nhân sự
- Quản lý danh sách nhân sự
  - Admin
  - Manager
  - D Manager
  - Kế toán
  - Kỹ thuật
  - Support
  - Kho
  - Sales
  - Khách hàng
  - Các vai trò custom do Admin tạo thêm

Form thêm mới vai trò:
- Tên vai trò
- Mã vai trò
- Mô tả
- Trạng thái hoạt động
- Permission được cấp

Form thêm mới nhân sự:
- Họ và tên
- Ngày tháng năm sinh
- Giới tính
- Số điện thoại
- Email
- Địa chỉ
- User đăng nhập
- Mật khẩu
- Vai trò
- Trạng thái tài khoản
- Ngày vào làm

Quy tắc validate User đăng nhập:
- Tối thiểu 8 ký tự
- Không chứa khoảng trắng
- Không chứa ký tự đặc biệt
- Không chứa dấu tiếng Việt
- Chỉ cho phép chữ A-Z, a-z và số 0-9
- Không được trùng user đã tồn tại
- Regex: ^[A-Za-z0-9]{8,}$

Ví dụ hợp lệ:
- nguyenvana
- ketoan001
- manager01
- support01

Ví dụ không hợp lệ:
- nguyen van a
- admin@01
- kt-001
- abc123
- kếtoan001

Database tối thiểu:
- users
- roles
- permissions
- user_roles
- role_permissions
- audit_logs
- app_settings
- backup_logs
- login_sessions

Yêu cầu giao diện:
- Đẹp, hiện đại, giống phong cách KiotViet/POS Việt Nam nhưng không sao chép.
- Sidebar trái.
- Topbar trên.
- Màu sáng, dễ nhìn.
- Bảng danh sách nhân sự có tìm kiếm, lọc theo vai trò, trạng thái.
- Form tạo mới rõ ràng.
- Có thông báo lỗi validate ngay trên form.
- Có popup xác nhận khi khóa/xóa/sửa tài khoản hoặc vai trò.
- Có nút Hủy ở mọi popup xác nhận.

Yêu cầu backup:
- Có chức năng backup database SQLite ra file .db hoặc .zip.
- Có thư mục backups/.
- Ghi log mỗi lần backup.
- Restore phải yêu cầu mật khẩu Admin.
- Trước khi restore phải tạo backup hiện trạng.
- Thiết kế sẵn interface FutureSyncService để sau này sync VPS/PostgreSQL nhưng chưa cần làm sync thật ở G1.

Cấu trúc repo:
apps/desktop
packages/database
packages/shared
packages/business-rules
bible
prompts
qa
reports

Điều kiện PASS:
- Chạy được local.
- Build được file .exe.
- Login được bằng adminroot.
- Admin bắt buộc đổi mật khẩu lần đầu.
- Admin tạo được vai trò mới.
- Admin sửa/khóa/mở khóa/xóa vai trò đúng luật.
- Admin tạo được nhân sự mới.
- Manager tạo user giới hạn đúng luật.
- Role khác không được tạo/xóa user mặc định.
- User đăng nhập sai quy tắc bị chặn.
- Danh sách nhân sự hiển thị theo từng vai trò.
- Xóa user/role yêu cầu nhập mật khẩu.
- Sửa user/role có xác nhận Có/Hủy.
- Có toast notification.
- Có audit log.
- Có backup database local.
- Có test report.
- Có báo cáo reports/G1_LOCAL_DESKTOP_ADMIN_HR_REPORT.md.

Không hỏi lại user.
Không tự claim PASS nếu chưa chạy test/build thật.
```

---

## 24. Kết luận

SPEC v1.0 này khóa đúng hướng:

```text
Local trước
EXE trước
Admin trước
Role + Permission trước
Nhân sự trước
Audit trước
Backup trước
Doanh thu/kho/thu chi làm sau
```

Đây là nền móng đủ chắc để phát triển thành phần mềm quản lý nội bộ lâu dài, có thể mở rộng sang doanh thu, kho, thu chi, công nợ, báo cáo, multi-branch và VPS sync mà không phải phá kiến trúc ban đầu.

Mô tả: giao diện đăng nhập hiện đại, có user, pass, có tích chọn hiện thị passm nặc định ẩn, ghi nhớ đăng nhập lần sau mở lại luôn ghi nhớ user mật khẩu, đăng nhập xong vào giao diện Trang chủ
Cấu hình trên menu sẽ có: Trang chủ, Quản lý Nhân sự như cấu trúc trên, Cấu hình ngân hàng, phần ngân hàng tương tự như nhân sự, các vai trò nào mới được cấu hình chức năng này thì set cho logic
Quản lý Ngân hàng có Thêm mới Ngân hàng, Quản lý Danh sách ngân hàng, Cấu hình Loại thẻ Trên máy Pos
- Bên cạnh ngân hàng sẽ có Quản lý Đối tác, tương tự ngân hàng sẽ có Thêm mới đối tác, Quản lý danh sách đối tác, Thiết lập Liên kết sản phẩm ngân hàng và đối tác, Thiết lập biểu phí Pos Ngân hàng của đối tác
