# G1 AUDIT REPORT — Phase A slice (Login → Force Change → Dashboard)

**Auditor:** CMD_AUDIT (Claude, độc lập với CMD_BUILD).
**Ngày:** 2026-07-09. **Commit gốc audit:** sau `d064ba5` (apps/desktop chưa commit lúc audit).
**Verdict:** ✅ **ENGINEERING PASS cho Phase A slice** — KHÔNG phải Production PASS (R196), KHÔNG phải full G1 §21.

## B1 — Chạy lại bằng máy (CMD_AUDIT tự chạy, không tin report builder)
| Lệnh | Kết quả | Exit |
|------|---------|------|
| `npm test` (root, Vitest) | **41/41 PASS** (validators 17 + user.rules 11 + auth.rules 13) | 0 |
| `npm run typecheck -w @glb/desktop` (tsc node+web) | **0 lỗi** | 0 |
| `npm run build -w @glb/desktop` (electron-vite) | build OK, font Be Vietnam Pro bundle offline (woff2) | 0 |
| Headless self-test (`GLB_SELFTEST=1`, DB copy riêng) | **5/5** ↓ | 0 |

Self-test (chạy trên bản copy `selftest.db`, dev.db giữ nguyên):
- `wrong_password` → `ok:false, error:INVALID_CREDENTIALS` (KHÔNG lộ status — bảo mật ✓)
- `admin_login` → `ok:true, mustChange:true, roles:[ADMIN], perms:20` (R002 bcrypt + R003 force-change ✓)
- `change_password` → ok · `restore_password` → ok · `me` → `adminroot` (session ✓)

## B4 — Đọc code rule-critical
- `auth-service.login`: verify password TRƯỚC status → sai mật khẩu luôn `INVALID_CREDENTIALS`, không lộ tài khoản khóa/pending. Audit `LOGIN_FAILED`/`LOGIN_SUCCESS` có actor + reason. ✓
- `buildAuthUser`: chỉ role `ACTIVE` mới cấp permission (role LOCKED = 0 quyền). ✓
- `changePassword`: verify current + `validatePassword` + chặn trùng mật khẩu cũ + clear `force_change_password` + audit `PASSWORD_CHANGED`. ✓ (nghiêm hơn spec)
- `ipc.ts`: renderer KHÔNG chạm DB — mọi thao tác sau `ipcMain.handle`. contextIsolation on, nodeIntegration off. ✓
- `remember.ts`: credential mã hóa qua `safeStorage`, plaintext không rời main. ✓
- `Dashboard.tsx`: menu lọc theo `hasPermission(user, perm)` → **R010 ẩn theo quyền** (không disable). ✓ check bằng permission, KHÔNG bằng role (§13). ✓
- `App.tsx`: routing login → (mustChange||forceChangePassword) → force-change → dashboard. ✓

## B7 — Đối chiếu §21 (chỉ các mục thuộc Phase A)
| §21 | Điều kiện | Phase A |
|----|-----------|---------|
| #1 | Chạy được local | ✅ build+run thật |
| #3 | Login `adminroot` | ✅ self-test |
| #4 | Buộc đổi mật khẩu lần đầu | ✅ mustChange=true + routing |
| #8 | Username validate đúng rule | ✅ 17 test |
| #15 | Audit log | ✅ LOGIN_*/PASSWORD_CHANGED ghi thật |
Các mục #2 (.exe), #5–7/#9–14/#16 (role/user/backup) = **Phase B/C, chưa claim**.

## Findings (không chặn Phase A, phải xử ở Phase B/C)
1. **[UI-evidence]** `apps/desktop/build/after_login_screenshot.png` **sai nhãn** — thực chất là màn login (đang hiện mật khẩu + lỗi inline), KHÔNG phải Dashboard. Dashboard verify qua CODE + routing, chưa có screenshot thật. → Phase B: chụp lại Dashboard thật.
2. **[PROD-DB]** DB đóng gói `userData/glb.db` chưa có migration schema; `.exe` chạy lần đầu trên DB rỗng sẽ lỗi "no such table" (seedIfEmpty cần bảng trước). Dev ẩn lỗi này vì trỏ `packages/database/dev.db`. → **Chặn .exe, phải fix Phase C** (ship migrations / `db push` on first run). Builder đã khai báo trung thực.
3. **[ABI]** better-sqlite3 rebuild cho Electron (ABI 130) → hỏng dưới Node 24 → `npm run db:seed`/Prisma CLI dưới Node ABI-fail. → Phase C: postinstall `electron-rebuild` + tách ABI dev-node/electron.
4. **[SELFTEST-HOOK]** `GLB_SELFTEST` còn trong `src/main/index.ts` (env-gated, vô hại, hữu ích cho audit). Giữ tới khi có CI.

## Kết luận
Slice Phase A **CHẠY THẬT + đúng luật auth/permission**. Đủ điều kiện chuyển Phase B (role/user CRUD + audit UI + backup). **Chưa** đóng `.exe` (finding #2/#3). Theo R196: đây là L1 Engineering PASS — chờ **LEAD (Mr.Long) tự chạy `npm run dev` + chấp nhận** mới lên L2 và mới push repo.

---

# PHASE B AUDIT — Role/User CRUD + Audit UI + Backup (2026-07-09)

**Verdict:** ✅ **ENGINEERING PASS** (L1). CMD_AUDIT tự chạy lại, KHÔNG tin report builder.

## B1 — Chạy lại bằng máy
| Lệnh | Kết quả |
|------|---------|
| `prisma generate` + `npm test` | **61/61 PASS** (41 A + 20 B: role/user/audit/backup rules) |
| `tsc` node+web | **0 lỗi** |
| `npm run build -w @glb/desktop` | **exit 0**, no warning |
| `GLB_SELFTEST=2` (service layer thật, copy DB) | **24/24 PASS, failures=0** |

Self-test 2 phủ (em tự chạy): R004 last-admin · R_ROLE_005 (role-with-users) · R_ROLE_006 (ADMIN system role) · R_ROLE_009 (delete role sai mật khẩu) · R_BACKUP_002 (restore sai pass) · R_BACKUP_003 (auto pre-restore backup: 1→2) · R_MANAGER_001/002 · §13 FORBIDDEN (manager không tạo role, sales không list user) · R_AUDIT_003 (3 denial được audit).

## B4 — Đọc enforcement core (không tin self-test suông)
- `guard.ts::requirePermission`: check permission CODE + audit `PERMISSION_DENIED` khi từ chối (R_AUDIT_003). `verifyActorPassword` server-side. ✓
- `user-service.ts`: last-admin (đếm ACTIVE admin loại trừ target) · self-escalation block (R006) · manager scope (canCreateUserWithRoles/grantsExceedActor) · soft-delete · xóa cần verifyActorPassword (§14) · audit before/after. ✓
- **R_AUDIT_001**: KHÔNG có endpoint app xóa audit (chỉ stub trong Prisma generated). ✓

## Findings Phase B
- **[B01]** builder tự phát hiện+fix: schema thiếu `join_date` (§9). Đã migration + logged BUGS_FIXED. CMD_AUDIT xác nhận migration `20260709120000_add_user_join_date` tồn tại + type có sau `prisma generate`. Regression đề xuất: test "schema-vs-spec field coverage" (Phase C).
- **[Phase C]** Restore = staged (`glb.db.restored`, chưa swap khi DB đang mở) — swap-on-restart để Phase C. UI thông báo trung thực.
- Không phát hiện bug logic mới. Không có gì để CMD_AUDIT fix.

## Kết luận Phase B
Role/User/Audit/Backup **CHẠY THẬT + đúng luật**. 61 test + 24 self-test độc lập PASS. Còn lại: **Phase C** = restore swap-on-restart + đóng `.exe` (migration đóng gói + electron-rebuild). L1 Engineering PASS — chờ LEAD nghiệm thu.
