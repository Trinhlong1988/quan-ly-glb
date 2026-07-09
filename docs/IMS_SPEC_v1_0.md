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
Cấu hình trên menu sẽ có: 
A. Trang chủ 
1. Hiển thị Doanh Số tháng này (để sẵn logic dữ liệu sau)
2. Lợi nhuận tháng này (để sẵn logic dữ liệu sau)
3. Chi phí Kinh doanh tháng này (để sẵn logic dữ liệu sau)
4. Chi phí Hồ sơ tháng này (để sẵn logic dữ liệu sau)
5. Chi phí Văn phòng tháng này (để sẵn logic dữ liệu sau)
6. Chi phí lương tháng này (để sẵn logic dữ liệu sau)

7. Máy Pos mới nhập tháng này(để sẵn logic dữ liệu sau)
8. Danh sách TID phát sinh tháng này (để sẵn logic dữ liệu sau)
9. Công nợ tồn đọng (để sẵn logic dữ liệu sau)
10. Số TID hoạt động tháng này (để sẵn logic dữ liệu sau)
11. Số TID không hoạt động tháng này (để sẵn logic dữ liệu sau)
12. Số TID đã đóng tháng này (để sẵn logic dữ liệu sau)


B. Quản lý Nhân sự như cấu trúc trên… đã note trong md


C. Cấu hình ngân hàng bao gồm, 
phần ngân hàng tương tự như nhân sự, các vai trò nào mới được cấu hình chức năng này thì set cho logic

1. Thêm mới Ngân hàng, 
- Tên Ngân hàng
- Mã Ngân hàng
Xác nhận – Hủy bỏ (button) 
- Thông báo khi thêm ngân hàng mới thành công hoặc lỗi, thông báo ngân hàng đã tồn tại
Sau khi thêm mới bên dưới sẽ có danh sách Ngân hàng thêm mới realtime, có lịch sử user thêm mới là ai, ngày giờ thao tác thêm mới(đây là yếu tố truy vết)

2. Quản lý Danh sách ngân hàng 
- danh sách ngân hàng hiện thị từ dữ liệu thêm mới ngân hàng
- Có tích chọn 1 hoặc nhiều ngân hàng
Button: Làm mới, Chỉnh sửa, Bỏ tích, Xóa ngân hàng đã chọn, Xuất Excel, khi thao tác chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
Thao tác xong luôn có thông báo push như thêm mới ngân hàng
(thêm yếu tố truy vết trong danh sách ngân hàng hiển thị người sửa hoặc thao tác gần nhất)

3. Cấu hình Loại thẻ sử dụng trên máy Pos
a. Thêm mới loại thẻ sử dụng trên máy Pos
- Chọn ngân hàng (từ danh sách ngân hàng)
- Thêm mới loại thẻ
- Tên loại thẻ
- Mã loại thẻ
Hiển thị danh sách thẻ thêm mới realtime(có yếu tố truy vết)
Thao tác xong luôn có thông báo Pus
b. Quản lý danh sách thẻ theo ngân hàng
- Hiện thị danh sách ngân hàng, các loại thẻ sử dụng trên máy Pos
Button menu: có tích chọn ngân hàng, chọn loại thẻ sử dụng trên máy Pos của ngân hàng đó, Button Sửa, Xóa, Làm mới, Xuất Excel
chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
Thao tác xong luôn có thông báo push

4. Quản lý đối tác

a. Thêm mới đối tác: 
- Tên đối tác
- Mã đối tác
- Địa chỉ đối tác
- Số điện thoại
- Người liên hệ
Xác nhận – Hủy bỏ (button) 
Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật

b. Quản lý danh sách đối tác
- Hiển thị danh sách đối tác 
Menu button: Làm mới, sửa thông tin đối tác, Bỏ chọn đối tác, Xóa
chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật

c. Quản lý sản phẩm Ngân hàng liên kết với đối tác click vào hiện bảng: bản chất mỗi đối tác sẽ liên kết với nhiều ngân hàng khác nhau trong danh sách ngân hàng.
- Chọn đối tác (từ danh sách đối tác đã có)
- Chọn Ngân hàng liên kết đối tác (từ danh sách ngân hàng)
- Xác nhận – Hủy Bỏ (button)
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
- Hiển thị danh sách đối tác và ngân hàng liên kết dạng bảng hoặc hình cây hoặc bảng tích xanh các ngân hàng liên kết realtime

Button menu: Làm mới, Sửa Ngân hàng liên kết đối tác, Xóa đói tác chọn, Xuất Excel
- Xác nhận – Hủy Bỏ (button)
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật


5. Cấu hình phí mua, phí cài máy bao gồm 2 mục con
a. Cấu hình Loại phí bán:
- Thêm mới loại phí: bảng điền bao gồm
+ Tên loại phí (ví dụ ủy quyền, Tiền chờ, Tiền Nhanh…)
- Xác nhận – Hủy Bỏ (button)
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
- Hiển thị danh sách realtime, đầy đủ button: làm mới, sửa loại phí
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật - Xác nhận – Hủy Bỏ (button)

b. Cấu hình Giá % phí bán ra, phí bán click vào hiện bảng
- Chọn đối tác (từ danh sách đối tác)
- Chọn ngân hàng (từ danh sách ngân hàng liên kết với đối tác)
- Chọn Loại thẻ sử dụng trên máy Pos (thẻ này đã cấu hình ở trên) đi theo ngân hàng)
- Bên dưới có bảng set phí % như sau ví dụ 1.02 1.03 1.05 1.067 1.068… tối đa 3 số sau dấu “,” bao gồm: Phí mua (%), Phí Cài máy (%), Phí bán (%)
Set xong sẽ hiện thị 2 trường: Chênh lệch với NCC (%) áp thẳng luôn = Phí mua – phí cài máy (màu đỏ âm, màu xanh dương, đỏ âm cho vào trong ngoặc)
Phí chênh lẹch với Khách hàng = Phí bán (%) – phí cài máy (%) 2 mục này tương tự nhau chỉ hiển thị kết quả
- Hiển thị danh sách các loại phí như ủy quyền… đã thêm ở trên 
- Xác nhận – Hủy Bỏ (button)
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
Hiển thị danh sách realtime, đầy đủ button: làm mới, sửa loại phí, Xuất Exell
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật.

6. Cấu hình Nhà cung cấp máy Pos
a. Thêm mới đối NCC: 
- Tên đối tác
- Mã đối tác
- Địa chỉ NCC
- Số điện thoại
- Người liên hệ
Xác nhận – Hủy bỏ (button) 
Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật

b. Quản lý danh sách NCC
- Hiển thị danh sách NCC
Menu button: Làm mới, sửa thông tin đối tác, Bỏ chọn NCC, Xóa, Xuất exell
chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật



7. Quản lý Cấu hình máy Pos

a. Thêm mới Chủng Loại Pos
- Mã Máy Pos
- Tên Máy Pos
Xác nhận – Hủy bỏ (button) 
Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
Hiển thị realtime danh sách Pos vừa thêm

b. Quản lý Danh sách chủng loại Pos
- Hiển thị danh sách máy Pos tất cả
Menu button: Làm mới, sửa thông tin máy Pos, Bỏ chọn đối tác, Xóa
chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật

8. Quản lý nhập xuất máy Pos Công ty – Kho
a. Cấu hình trạng thái nhập máy:
- Thêm cấu hình trạng thái nhập máy: ví dụ Máy mới, máy cũ, Máy đổi, Máy thuê
Xác nhận – Hủy bỏ (button) 
Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
Hiển thị realtime danh sách trạng thái vừa thêm

b. Nhập kho – nhâp mới máy Pos
b1. Nhập máy vào kho quản lý: click vào hiển thị:
- Chọn chủng loại máy (từ danh sách chủng loại máy)
- Seri number: ô điền dạng chữ và số không giới hạn ký tự
- Chọn trạng thái nhập máy từ cấu hình 8a
- Chọn Nhà cung cấp
- Chọn Giá nhập
- Chọn ngày nhập (dạng ô date tách 3 trường dd mm yy ví dụ 1 ô ngày 03, ô tháng 12, ô năm 2026…
- Xác nhận – Hủy Bỏ
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
- Hiển thị realtime danh sách máy Pos vừa nhập kho quản lý:
b2. Quản lý danh sách máy Pos click vào hiển thị:
- Hiển thị realtime danh sách máy Pos tất cả quản lý:
- Danh sách hiển thị list, có số thứ tự (STT), Tên chủng loại, Seri number, Nhà cung cấp, giá nhập, ngày nhập, trạng thái…, 
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
- Hiển thị realtime danh sách máy Pos vừa nhập kho quản lý:
- Menu button: Làm mới, sửa thông tin máy Pos, Bỏ chọn máy Pos, Xóa, xuất Excel
- chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
- Mục sửa thông tin máy Pos phải cho chỉnh sửa full thông tin, được chuyển từ nhà cung cấp này sang nhà cung cấp khác tức là tùy chọn lại nhà cung cấp

8. Cấu hình Tài khoản nhận tiền – ủy quyền (là tài khoản ngân hàng gắn với mỗi TID ở mục 9
8a. Thêm mới nguồn tài khoản, click vào bảng hiển thị setup:
- Nguồn tài khoản ủy quyền: ví dụ Khách hàng, Nội bộ…
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
- 
8b. Thêm mới tài khoản nhận tiền – ủy quyền
- Thêm mới tài khoản: click hiện setup:
+ Tên tài khoản
+ Số tài khoản
+ Ngân hàng
+ Chi nhánh
+ Số CCCD nhận Ủy quyền – nhận tiền, Ngày cấp, nơi cấp, ngày hết hạn…
+ Tải ảnh CCCD 2 mặt (attack file mặt trước, mặt sau)
+ Số điện thoại
+ Email đối soát điền thông tin dạng email
+ Tùy chọn tài khoản thuộc khách hàng nào (từ nguồn danh sách khách hàng hoặc nội bộ do vai trò user lúc khởi tạo)
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách mới: STT, nguồn tài khoản, Mã User gắn với vai trò user, Tên STK, STK, Ngân hàng… ngày thêm, user sửa hoặc tạo mới nhất, ghi chú
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật


8c. Quản lý danh sách nguồn tài khoản nhận tiền - ủy quyền
- Hiển thị bảng danh sách bao gồm: Số thứ tự, tên nguồn tài khoản, ngày thêm, user thêm
- Hiển thị realtime danh sách tất cả cũ mới, đảm bảo truy vết
- Menu button: Làm mới, sửa thông tin, Bỏ chọn, Xóa
- chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
- Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
- Hiển thị realtime danh sách tất cả cũ mới: STT, nguồn tài khoản, Mã User gắn với vai trò user, Tên STK, STK, Ngân hàng… ngày thêm, user sửa hoặc tạo mới nhất, ghi chú
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật.

9. Quản lý TID/POS: mỗi thiết bị có thể được gắn 1 hoặc nhiều TID hoặc hủy bỏ, xóa TID cũ đi thêm TID mới.
9a. Cấu hình trạng thái TID, click vào hiện bảng setup
- Thêm mới trạng thái:
+ Điền thông tin trạng thái: ví dụ: mới cấp, thu hồi.. đổi cho đối tác
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách tất cả cũ mới, đảm bảo truy vết


9a. Thêm mới TID click vào sẽ hiện bảng setup như sau:
- Chọn Ngân hàng (từ danh sách ngân hàng)
- Chọn Đối tác (từ danh sách đối tác), chọn xong sẽ show ra biểu phí mua bán cài máy chi tiết từ trường cấu hình ở trên
- Điền thông tin TID: dạng ký tự hoặc số không giới hạn
- Điền thông tin Hộ Kinh Doanh: Tên Hộ Kinh Doanh máy Pos
- Chọn tài khoản từ nguồn nguồn tài khoản nhận tiền - ủy quyền
- Ngày cấp TID: dd/mm/yy cùng định dạng ở các mục trên
- Trạng thái: từ nguồn cấu hình trạng thái 9a
- Nguồn hồ sơ: từ nguồn hồ sơ 10.a
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách tất cả cũ mới, đảm bảo truy vết
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật

9b. Quản lý danh sách TID cũ – mới nhập:
- Hiển thị full bảng danh sách TID: STT, Tên HKD, TID, Ngân hàng, Đối tác, ngày cấp, biểu phí bán, phí mua, phí cài máy…, Trạng thái, nguồn hồ sơ, ngày tạo, sửa, user sửa hoặc tạo mới nhất, ghi chú
- Menu button: Làm mới, sửa thông tin, Bỏ chọn, Xóa
- chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
- Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách đối tác, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật.

10. Quản lý Hồ sơ
10a. Cấu hình nguồn hồ sơ, click hiện bảng setup:
- Thêm mới nguồn hồ sơ
- Mã nguồn hồ sơ
- Chính sách chiết khấu (%): điền dạng % như 0.5 0.05 0.02 0.003… tối đa 3 số sau dấu phẩy)
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách mới, đảm bảo truy vết
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
10b. Quản lý danh sách nguồn hồ sơ
- Hiển thị realtime danh sách tất cả cũ mới, đảm bảo truy vết
- Thông báo Push khi thêm mới thành công, hiển thị realtime danh sách, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
- Menu button: Làm mới, sửa thông tin, Bỏ chọn, Xóa
- chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
- Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật
10c. Thêm mới hồ sơ:
10c1. Thêm mới hồ sơ click hiện bảng Setup như sau:
- Tùy chọn nguồn hồ sơ (từ danh sách)
- Tên Hộ Kinh Doanh: điền dạng Text, số…
- Địa chỉ đăng ký HKD:
- Mã số Thuế - Mã số ĐK HKD:
- Ngày Cấp ĐKKD:
- Nơi cấp ĐKKD:
- Tên chủ hộ Kinh doanh:
- Giới tính
- Dân tộc
- Số CCCD: 
- Ngày cấp:
- Nơi cấp:
- Ngày hết hạn:
- Địa chỉ thường Trú:
- Nơi ở hiện tại:
- Tùy chọn nguồn hồ sơ (sổ ra tùy chọn từ 10b
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách mới, đảm bảo truy vết
- Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật


10c2. Thêm mới dữ liệu Hồ sơ:
- Chọn Hộ kinh Doanh từ nguồn 10c1
- Tải lên Ảnh ĐKKD (attack file PNG, JPG, PDF)
+ mặt trước
+ mặt sau
Chọn xong tự link show ra tên chủ hộ kinh doanh và cho phép
- Tải lên CCCD (attack file PNG, JPG, PDF)
+ mặt trước
+ mặt sau
- Tải lên Ảnh ĐKKD (attack file PNG, JPG, PDF)
+ mặt trước
+ mặt sau
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách mới, đảm bảo truy vết
- Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật.

10d. Quản lý danh sách dữ liệu hồ sơ:
- Click vào hiển thị full thông tin bảng 10c1 
- Menu button: Làm mới, sửa thông tin, Bỏ chọn, Xóa
- chỉnh sửa hay xóa phải có Xác nhận – Hủy bỏ (button)
- Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật

11. Quản lý chi tiết TID/ POS: sau khi cấu hình xong máy pos nhập kho, TID mới nhập, TID sẽ được gắn với 1 thiết bị máy Pos duy nhất tại 1 thời điểm

11a. Cấu hình TID vào máy POS, click vào hiện bảng setup
- Chọn TID từ nguồn TID tồn kho, chỉ show nguồn TID chưa được gắn với POS (seri number trống chưa gắn tid)
- Chọn xong show full thông tin TID ở cấu hình 9b
- Chọn Pos (từ nguồn Seri number nguồn POS tồn kho chỉ show Pos chưa gắn Tid hoặc đang trống
- Chọn trạng thái TID (cài đặt sãn có trạng Thái: Nhập kho chưa giao, Giao TID luôn. 
- Nếu chưa giao nhập kho thực hiện luôn: Xác nhận 
- Xác nhận – Hủy bỏ (Button)
- Nếu Giao TID luôn show ra chọn giao cho ai: user mã user từ nguồn user, danh sách khách hàng (user)
- Chọn Tài khoản ủy quyền
- Chọn ngày giao TID
- Cấu hình giá bán, giá mua, giá cài máy (giá cấu hình ở trên là giá công ty niêm yết còn bây giờ là set giá thực bán) mỗi khách hàng một giá bán khác nhau đặc biệt lưu ý vấn đề này
- Show trạng thái tích tùy chọn Ủy quyền, tiền chờ hay tiền nhanh đã được cấu hình (giá mua, giá cài máy đã niêm yết chỉ có giá bán tùy chỉnh)
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách mới, đảm bảo truy vết
- Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật.
- Chọn khách hàng giao ( từ danh sách User bao gồm Mã User, Tên Khách hàng


12. Quản lý thu chi (nghiên cứu thiết kế phù hợp với đặc tính của phần mềm và báo cáo thu chi phân tích app sẵn thị trường tối ưu)
13. Hướng dẫn sử dụng
14. Đăng xuất

Phân mô tả cần tư vấn, nghiên cứu sâu: cần có thư viện quản lý dữ liệu máy pos, TID, user chuẩn hóa, hành vi user, lịch sử user, vi phạm, quyền hạn, quy tắc, đặc biệt bảo mật dữ liệu.

1. 1 máy Pos vật lý có seri number có thể được gắn với nhiều TID do TID bị đóng, chết, máy Pos có thể bị hư hỏng phải đi bảo trì, trong quá trình sử dụng TID có thể chết thì thay TID khác, hoặc thu hồi cả TID, máy Pos từ khách hàng về kho nhập kho, hoặc chuyển từ đại lý này sang đại lý khác, phải có thư viện quản lý máy Pos có lịch sử thao tác di chuyển, chuyển đổi, thu hồi hoặc báo hỏng, sửa, nhận sửa xong , thời gian phải cụ thể chi tiết dễ quản lý
2. Cần có mục quản lý danh sách TID chưa giao và Push thông báo mỗi ngày vì lãng phí không mang lại nguồn thu
3. Trường Quản lý Doanh số: đặc biệt quan trọng cho thành mục 2 hoặc 3 hoặc em tự sắp xếp khi click vào Quản lý doanh số sẽ hiển thị:
- Bảng setup chọn: TID, khi chọn TID sẽ show thông tin bao gồm: HỘ KINH DOANH, Phí mua, phí cài máy, phí bán (%), Thông tin TID đó giao cho khách hàng nào: tên Khách hàng – mã Khách hàng, ngày giao
- Trường điền Doanh số: dạng số ví dụ 1000,000,000 không giới hạn 
- Trường chọn loại thẻ: thẻ đã được cấu hình, mỗi loại thẻ có 1 giá mua, giá cài máy và giá bán khác nhau kiểm tra xem có chưa và bổ xung nếu chưa có thì đưa vào cấu hình đúng mục giá mua giá bán từng loại thẻ
- Điền doanh số xong sẽ tự cho ra từ công thức kết quả thành tiền phí chênh thu của khách hàng, thành tiền phí chênh thu của Đối tác
- = % phí chênh (theo công thức đã có) * số tiền doanh số
- Tùy chọn thời gian: từ ngày: dd mm yy đến ngày dd mm yy
- Xác nhận – Hủy bỏ (Button)
- Hiển thị realtime danh sách mới, đảm bảo truy vết
- Thao tác xong luôn có thông báo push, lưu ý yếu tố truy vết, lỗi trùng lặp thông tin… dialog báo rõ ràng nổi bật.
- Thêm hóa đơn doanh số xong thì show ở dưới luôn STT, thời gian từ đến từ, TID, Tên HKD, Khách Hàng, Doanh số… % phí chênh, thành tiền phí chênh, Tổng bên dưới từng loại phí







 














