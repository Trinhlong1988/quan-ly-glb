# PHASE G10 — TRIỂN KHAI ĐA MÁY (Postgres LAN server + .exe client)

> **Vai trò:** LEAD/CMD_AUDIT viết khung spec + gate (chưa code). CMD_BUILD chỉ được implement **SAU KHI P1.2 freeze + tag `p1.2`** (WORKFLOW TỐI THƯỢNG: tier N+1 khóa tới khi tier N tagged).
> **Trạng thái:** KHUNG (skeleton) — nhiều mục `TENTATIVE_SUY_LUẬN` cần Mr.Long chốt trước khi CMD_BUILD chạm code. CẤM implement mục TENTATIVE khi chưa duyệt.
> **Nguồn kiến trúc đã chốt (Mr.Long):** máy này = **Postgres server trên LAN** (nguồn dữ liệu master), máy B... = **client LAN** kết nối qua IP nội bộ để nhập liệu realtime dùng chung. KHÔNG cloud/VPS. Client là **.exe đóng gói**.

---

## §1. Mục tiêu & phạm vi

| Hạng mục | Nội dung |
|---|---|
| G10.1 | Đóng gói client thành **.exe** (electron-builder) — cài trên máy B, C… |
| G10.2 | Chuyển data store **SQLite → PostgreSQL** (adapter Prisma) đặt trên máy này |
| G10.3 | **Cấu hình kết nối LAN**: client trỏ tới IP:port Postgres máy này; máy này mở server + firewall |
| G10.4 | **Đồng thời nhiều client (concurrency)**: đảm bảo nhập liệu realtime dùng chung không mất/đè dữ liệu |
| G10.5 | Backup + khôi phục trên nền Postgres (thay cơ chế backup SQLite hiện tại) |

**Ngoài phạm vi G10** (frame sau, không làm ở đây): multi-branch, row-level permission, master data kho/sản phẩm (xem `SPEC_V2_GAP_AND_BACKLOG.md` Nhóm 2).

---

## §2. Quyết định — ✅ CHỐT (Mr.Long 10/7)

| # | Quyết định | ✅ ĐÃ CHỐT | Ghi chú thực thi |
|---|---|---|---|
| Q1 | Phiên bản Postgres + cách cài | **PostgreSQL 16, installer chính thức trên máy này** | adapter Prisma `@prisma/adapter-pg` + `pg`; provider `postgresql` |
| Q2 | Data cũ SQLite | **BỎ — khởi tạo Postgres rỗng + seed adminroot** | KHÔNG migrate dev.db |
| Q3+Q4 | Mô hình kết nối/credential (đã gỡ mâu thuẫn — **Mr.Long chốt A 10/7**) | **A — Client nối THẲNG Postgres.** Màn "Cấu hình máy chủ" nhập IP:port + **1 tài khoản pg chung (mật khẩu LƯU trong config máy client)**. Chấp nhận rủi ro LAN nội bộ tin cậy. Đăng nhập app-level giữ nguyên; audit ghi user APP. | **Ràng buộc từ QA:** chỉ **máy chủ** chạy seed/migrate (client chỉ connect — tách server-init/client-init); tranh chấp duyệt = conditional transition (I-G3). Không chọn B (API layer) / C (pg trust). |
| Q5 | Auto-update .exe | **HOÃN — cài tay bản mới** | |
| Q6 | Khóa ghi đồng thời | **Transaction Postgres + optimistic (updatedAt) cho sửa; test 2 client song song** | Xem §4 I-G2/I-G3 |

> Quyết định đã chốt → G10 được phép code SAU KHI F-NOTIF freeze+tag (thứ tự pipeline). Không còn mục TENTATIVE nào chặn.

---

## §3. Điều kiện tiên quyết (prereq — làm trước khi vào G10.x)

1. **P1.2 phải FROZEN + tag `p1.2`** (LEAD Production accept theo R196). Chưa tag → G10 KHÔNG bắt đầu.
2. `electron-builder` **chưa cài** (`apps/desktop` chỉ có `electron-vite build`). G10.1 phải thêm dev-dep + config `electron-builder.yml`.
3. Prisma adapter Postgres (`@prisma/adapter-pg` + `pg`) thay `better-sqlite3` — cần đổi `datasource` provider `sqlite`→`postgresql` + rà **toàn bộ migration** (SQLite SQL không tương thích 100% Postgres: `AUTOINCREMENT`, `DATETIME`, boolean…). **Đây là rủi ro lớn nhất** — cần bước "regenerate migrations cho Postgres" riêng.

---

## §4. Bất biến (invariants) — gate phải kiểm

- **I-G1** Client .exe khởi động được không cần Node/npm cài sẵn trên máy B.
- **I-G2** 2 client ghi cùng lúc (2 bill khác nhau) → cả 2 vào DB, không mất, không trùng mã chứng từ (test `code_counter` atomic dưới Postgres).
- **I-G3** 2 client sửa/hủy cùng 1 bản ghi → chỉ 1 thắng, cái còn lại nhận lỗi rõ ràng (không mất-cập-nhật thầm lặng).
- **I-G4** Mất kết nối LAN giữa chừng → client báo lỗi rõ, không ghi rác, không treo.
- **I-G5** Toàn bộ regression cũ (REV15 73/0, selftest 1–18) **chạy lại xanh trên Postgres**, không chỉ SQLite.
- **I-G6** Backup Postgres tạo được + khôi phục ra đúng dữ liệu (dump/restore).

---

## §5. Gate nghiệm thu G10 (CMD_AUDIT verify độc lập — CẤM tin số liệu CMD_BUILD)

| Gate | Điều kiện PASS |
|---|---|
| G-G10.1 build .exe | `electron-builder` sinh ra 1 installer/.exe chạy được; log build 0 error |
| G-G10.2 typecheck+vitest | typecheck node+web = 0; vitest ≥ số hiện tại; build 0 |
| G-G10.3 migrate Postgres | `prisma migrate deploy` lên Postgres rỗng = 0 lỗi, đủ bảng |
| G-G10.4 regression trên Postgres | selftest 1–18 + REV15 chạy với `GLB_DB_URL` trỏ Postgres → toàn 0 fail |
| G-G10.5 concurrency test | selftest MỚI **=20** (19 đã dành cho F-NOTIF) mô phỏng 2 phiên ghi song song → I-G2/I-G3 PASS |
| G-G10.6 LAN thực tế | ≥1 máy B thật kết nối nhập 1 bill → máy này thấy realtime (Production Validation R196, Mr.Long accept) |

> **Freeze order:** G10.1→G10.2→…→G10.6, mỗi bước xanh mới sang bước kế. KHÔNG build song song. Sau G10.6 + Mr.Long accept → freeze + tag `g10-deployment`.

---

## §6. Rủi ro đã nhận diện

1. **Migration SQLite→Postgres không tự động tương thích** — cần viết lại/kiểm từng file `migration.sql` (kiểu dữ liệu, AUTOINCREMENT→SERIAL/IDENTITY, DATETIME→TIMESTAMPTZ, boolean). Rủi ro cao nhất.
2. **Timezone**: máy UTC+7. `startOfDayLocal` (đã fix F1) + Postgres `TIMESTAMPTZ` cần kiểm lại để không tái lỗi lệch ngày (regression F1/B16).
3. **Bảo mật chuỗi kết nối** trong client .exe (Q3/Q4).
4. **Firewall/port** máy này phải mở cho LAN — hướng dẫn cài đặt cho người vận hành.

---

## §7. Việc CMD_BUILD (chỉ chạy sau khi Mr.Long duyệt §2 + P1.2 tag)
Thứ tự cuốn chiếu, mỗi mục có gate ở §5:
1. Thêm `electron-builder` + config, build .exe thử (G10.1).
2. Đổi Prisma provider + adapter Postgres, **regenerate & kiểm toàn bộ migration** (G10.2/G10.3).
3. Chạy lại toàn bộ selftest/REV15 trên Postgres (G10.4).
4. Viết selftest concurrency mới (G10.5).
5. Backup/restore Postgres (I-G6).
6. Thử nghiệm LAN thật với máy B (G10.6, Mr.Long accept).

> CẤM commit/tag/push (chỉ LEAD). Chỉ làm trên ổ D. KHÔNG đụng bản C.

---

## §8. Chi tiết thực thi (mô hình A + đã sửa theo 13 QA findings §9)

> Thứ tự cuốn chiếu: **G10.1 (.exe, low-risk, độc lập DB) → G10.2 (swap Postgres) → G10.3 (migration squash + server config) → G10.4 (regression on pg) → G10.5 (concurrency) → I-G6 (backup) → G10.6 (LAN thật)**. Mỗi bước gate riêng.

### G10.1 — Đóng gói .exe (electron-builder) — làm TRƯỚC, chưa đụng Postgres
- Thêm dev-dep `electron-builder`; script `"dist": "electron-vite build && electron-builder --win"`.
- `electron-builder.yml`: `appId: com.globeway.glb`, `productName: "Quản Lý GLB"`, target `nsis`.
- **Đóng gói đúng (QA #10):** generator = `prisma-client` (queryCompiler, **KHÔNG có query-engine binary**) → KHÔNG asarUnpack engine. Đóng gói generated Prisma client (Wasm) + native `better-sqlite3` HIỆN TẠI (bước này vẫn SQLite). `asarUnpack` cho `better-sqlite3` (.node). Kiểm path khi `app.isPackaged`.
- Gate G-G10.1: installer sinh ra → cài máy sạch → app mở, đăng nhập adminroot OK (vẫn SQLite local — chỉ kiểm đóng gói).

### G10.2 — Swap adapter SQLite → Postgres (mô hình A: client nối thẳng)
- Sửa **`packages/database/src/client.ts`** (QA #3 — KHÔNG phải db.ts): `PrismaBetterSqlite3` → `@prisma/adapter-pg` (`PrismaPg`) + `pg`. Đổi `datasource` provider `sqlite`→`postgresql`. Gỡ dep native `better-sqlite3` + `adapter-better-sqlite3` khỏi `package.json`; sửa `electron.vite.config.ts` externals → `pg`/`adapter-pg`.
- **Tách init (QA #4, mô hình A):** `db.ts` `resolveDatabaseUrl` đọc IP:port từ file cấu hình máy client (màn "Cấu hình máy chủ") + tài khoản pg chung → dựng `postgresql://`. **CHỈ máy chủ chạy `seedIfEmpty`+migrate+`backfillEmployeeCodes` (1 lần)**; client boot **chỉ connect** (bỏ `existsSync(file:)`/seed mỗi boot). Cờ phân biệt server vs client (vd biến môi trường/cấu hình `GLB_ROLE=server|client`).

### G10.3 — Migration squash Postgres + cấu hình server (QA #1, #12)
- **SQUASH bắt buộc:** 13/15 migration cũ dính `PRAGMA/AUTOINCREMENT/DATETIME` → `migrate deploy` lên pg FAIL. Tạo **thư mục migrations MỚI cho Postgres** (1 baseline) sinh từ `prisma migrate diff --from-empty --to-schema-datamodel` → rà tay; đổi `migration_lock.toml` provider=postgresql. **Riêng frame này ĐƯỢC phép thay migrations** (gỡ luật "chỉ thêm mới" — QA #1). Migration SQLite cũ giữ nguyên trong lịch sử/tag, không dùng cho pg.
- **TZ (QA #7):** Prisma map `DateTime`→`timestamp` KHÔNG tz → ép `@db.Timestamptz(3)` tường minh cho các field ngày, HOẶC xác nhận xử lý UTC ở app. Gate: REV15-on-pg không tái lệch ngày (B16/F1).
- **Server config (QA #12):** `postgresql.conf` `listen_addresses='*'` (hoặc IP LAN) + `pg_hba.conf` `host all <user> <LAN_subnet> scram-sha-256` + mở firewall port 5432. Gate: máy B ping/psql nối được.
- Gate G-G10.3: `migrate deploy` lên Postgres rỗng = 0 lỗi, đủ bảng.

### G10.4 — Regression trên Postgres (QA #5)
- Test-harness đổi: SQLite copy-file throwaway KHÔNG dùng được. Mỗi selftest: tạo schema/DB tạm trên Postgres (createdb hoặc schema riêng) → migrate → chạy → drop. selftest 1–19 + REV15 với `GLB_DB_URL` trỏ pg → 0 fail. **`code_counter` (QA #8):** verify SQL `upsert{increment}` sinh ra; nếu không phải `INSERT..ON CONFLICT..RETURNING` native → dùng raw để atomic; gate concurrency N-cao assert mã unique.

### G10.5 — Concurrency (selftest =20, QA #8/#9)
- I-G2: N client tạo bill đồng thời → không trùng mã chứng từ (code_counter atomic).
- I-G3 (QA #9 — bill BẤT BIẾN nên race là ở duyệt hủy): 2 client cùng duyệt 1 `ApprovalRequest` → **conditional transition** `updateMany WHERE status='PENDING'` (count=0 → thua nhận lỗi "đã được xử lý"), KHÔNG optimistic updatedAt.

### I-G6 — Backup/Bảo trì trên Postgres (QA #6)
- Backup cũ = zip file SQLite + `VACUUM` → vỡ trên pg. Thay bằng `pg_dump`/`pg_restore` (script phía server; đóng gói hoặc gọi pg_dump cài sẵn). `MaintenanceRun.vacuumed` (VACUUM) → map sang `VACUUM (ANALYZE)` pg hoặc bỏ. Gate: dump→drop→restore→so hàng khớp.

### ② Lớp bug thêm cho G10 (QA #11): `type-mirror-drift`, `test-orphan` (selftest cũ khẳng định hành vi SQLite: throwaway copy, P2002/DUPLICATE_TRASH), `db-evolution-gap`.

### Nguồn cấp số selftest (chống đụng số): 1–18 cũ · 19 = F-NOTIF · **20 = G10 concurrency** · kế tiếp tăng dần.

### GAP fresh-install (G10.1 phát hiện — TỐI THƯỢNG GLOBAL: thiếu test class)
- **Triệu chứng:** máy sạch → gói mở ra, `userData/glb.db` rỗng, chưa migrate → `seedIfEmpty` throw → login FAIL. G10.1 chứng minh native-load OK bằng cách trỏ DB đã migrate, nhưng luồng end-to-end máy trắng chưa chạy.
- **Giải theo mô hình A:** client .exe **KHÔNG** dùng DB local — first-run mở màn "Cấu hình máy chủ" (Q3) nhập IP:port → connect Postgres máy chủ (đã migrate 1 lần ở G10.3). App **không được crash** khi chưa có cấu hình (hiện màn config thay vì throw). Vậy gap này do **G10.2 (client-init) + G10.3 (server migrate)** đóng, KHÔNG ship template SQLite.
- **Test class MỚI (bổ sung, chống lọt lại):** `packaged-fresh-install` — chạy binary đóng gói với `userData` RỖNG + CHƯA cấu hình máy chủ → phải ra màn config (không throw); sau khi trỏ server đã migrate → login OK. Gate bắt buộc ở **G10.6** (Production Validation LAN thật, Mr.Long).

---

## §9. QA RED-TEAM 10/7 — findings phải sửa TRƯỚC khi dispatch (đã verify code thật)

> Vòng lặp QA-trước-dispatch bắt 2 CRITICAL khiến G10 KHÔNG code được như §8 đang viết. Spec §8 sẽ được VIẾT LẠI sau khi Mr.Long chốt mô hình kết nối (dưới), vì kiến trúc phụ thuộc quyết định đó.

- **[CRITICAL-1] Migration squash bắt buộc.** `migration_lock.toml` = `sqlite`; 13/15 migration dùng `PRAGMA/AUTOINCREMENT/defer_foreign_keys/DATETIME` → `migrate deploy` lên Postgres FAIL ở migration đầu. **Phải squash 15 migration thành 1 baseline Postgres MỚI** (thư mục migrations riêng cho pg) + đổi `migration_lock` provider=postgresql. **Gỡ luật "migrations/* chỉ thêm mới" riêng cho frame G10** (mâu thuẫn). Sinh baseline qua `prisma migrate diff` từ schema rồi rà tay.
- **[CRITICAL-2] Mô hình kết nối/credential — CẦN Mr.Long chốt** (Q3/Q4 hiện mâu thuẫn: "không lưu mật khẩu DB trong client" vs "client tự nối Postgres"). 3 phương án — xem phần trình Mr.Long.
- [HIGH-3] Adapter ở `packages/database/src/client.ts` (`PrismaBetterSqlite3`), KHÔNG ở db.ts. Sửa client.ts + `electron.vite.config.ts` externals (→ pg/adapter-pg) + gỡ dep native `better-sqlite3`.
- [HIGH-4] `db.ts` bootstrap thuần SQLite (`resolveDatabaseUrl` file:, `existsSync`, `seedIfEmpty` + `backfillEmployeeCodes` **mỗi client boot** lên DB dùng chung → churn/deadlock). Tách **server-init (seed+migrate 1 lần) vs client-init (chỉ connect)**.
- [HIGH-5] Test-harness: selftest chạy trên **bản copy SQLite throwaway** (`GLB_DB_URL=file:`). Postgres không copy-file → mỗi test cần createdb/drop hoặc reset schema+migrate. Scope lại G-G10.4.
- [HIGH-6] Backup/Bảo trì: hiện zip file SQLite + `MaintenanceRun.vacuumed` (VACUUM) → **vỡ trên Postgres**. I-G6 cần bước `pg_dump/pg_restore` cụ thể + định số phận module Bảo trì.
- [MED-7] Prisma map `DateTime`→`timestamp` (WITHOUT tz), KHÔNG phải TIMESTAMPTZ. Ép `@db.Timestamptz(3)` tường minh HOẶC xử lý UTC ở app; giữ gate REV15-on-pg.
- [MED-8] `code_counter.nextCode` (`upsert{increment}`): dưới Postgres đồng thời có thể race → trùng mã. Verify SQL sinh ra / dùng raw `INSERT..ON CONFLICT DO UPDATE RETURNING`; gate concurrency N-cao.
- [MED-9] I-G3 sửa cơ chế: bill BẤT BIẾN (P1.2) → race thật = 2 client cùng duyệt 1 `ApprovalRequest` → dùng **conditional transition** (`updateMany WHERE status='PENDING'`, count=0 → thua) chứ không phải optimistic updatedAt (Q6 cũ).
- [MED-10] Đóng gói: generator `prisma-client` (queryCompiler, **không engine binary**) → bỏ khuyên asarUnpack engine; đóng gói generated client (Wasm) + `pg` (pure-JS); gỡ native; bỏ extraResources-migrations ở client (client không migrate runtime).
- [MED-11] ② G10 thêm lớp bug: `type-mirror-drift`, `test-orphan`, `db-evolution-gap`.
- [MED-12] Runway thiếu cấu hình server: `postgresql.conf listen_addresses` + `pg_hba.conf host` (điều kiện client LAN nối được) — thêm sub-task + gate kết nối từ máy B.
- [LOW-13] Gỡ câu "nhiều mục TENTATIVE" tồn dư ở §1 (đã chốt §2); ghi rõ read-list trong prompt.
