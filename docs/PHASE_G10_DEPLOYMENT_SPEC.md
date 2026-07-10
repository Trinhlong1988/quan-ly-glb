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

## §2. Quyết định cần Mr.Long chốt (TENTATIVE — CẤM code khi chưa duyệt)

| # | Quyết định | Phương án đề xuất (TENTATIVE) | Ghi chú |
|---|---|---|---|
| Q1 | Phiên bản Postgres | `TENTATIVE`: PostgreSQL 16 (LTS, better-sqlite3→pg adapter) | Cần chốt bản + cách cài (installer/Docker/portable) |
| Q2 | Data cũ SQLite | Mr.Long đã nói **"bỏ qua data cũ"** → khởi tạo Postgres rỗng + seed adminroot | Xác nhận lại: KHÔNG migrate dev.db |
| Q3 | Cấu hình kết nối client | `TENTATIVE`: màn hình "Cấu hình máy chủ" nhập IP:port lần đầu, lưu local (không lưu password DB trong client?) | Bảo mật chuỗi kết nối là điểm nhạy |
| Q4 | Xác thực client↔server | `TENTATIVE`: 1 DB user chung + login app-level (đã có) VS mỗi máy 1 credential | Ảnh hưởng audit "máy nào nhập" |
| Q5 | Auto-update .exe | `TENTATIVE`: **hoãn** (cài tay bản mới) — tránh over-engineer | |
| Q6 | Khóa ghi đồng thời | `TENTATIVE`: dựa transaction Postgres + optimistic (updatedAt) cho sửa | Xem §4 |

> **CẤM SUY LUẬN:** Không tự chọn giá trị Q1–Q6. Đánh dấu TENTATIVE tới khi Mr.Long duyệt.

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
| G-G10.5 concurrency test | selftest MỚI (=19?) mô phỏng 2 phiên ghi song song → I-G2/I-G3 PASS |
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
