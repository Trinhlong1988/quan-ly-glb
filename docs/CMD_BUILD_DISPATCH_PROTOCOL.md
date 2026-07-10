# PROTOCOL ĐIỀU PHỐI CMD_BUILD — chống thất bại quy trình (bắt buộc mọi dispatch)

> Sinh từ **rút kinh nghiệm sự cố 10/7** (P1.2). CẤM lặp lại. LEAD phải theo protocol này mỗi lần giao việc cho CMD_BUILD.

## PHẦN 1 — TOÀN BỘ ĐÃ SAI (phản biện, tường minh)

| # | Đã sai | Nguyên nhân gốc | Quy trình đã để lọt ở đâu |
|---|---|---|---|
| S1 | **Lệch vai**: Claude tự viết backend P1.2 + selftest + sửa test | CMD_BUILD hết phiên → tự "gánh" việc build thay vì spawn CMD_BUILD mới | Không có luật cứng "builder không rảnh → LEAD KHÔNG tự build" (vi phạm R1/R5) |
| S2 | **False-PASS lọt**: CMD_BUILD báo "typecheck node+web EXIT 0" nhưng web thực sự vỡ | Prompt yêu cầu agent tự chạy + tự báo số; số tự-báo được coi là bằng chứng | Không bắt buộc AUDIT chạy lại 100% gate từ trạng thái sạch; tin lời agent |
| S3 | **Clobber file hand-maintained**: `preload/index.d.ts` 1115→~174 dòng, mất DTO | **ROOT CAUSE THẬT (đính chính):** cạm bẫy tsconfig — `tsconfig.node/web.json` có `declaration:true`+`composite:true`, KHÔNG `noEmit`/`outDir`, `include` phủ cả `src/preload/index.d.ts`. Chạy `tsc -p` **trần (thiếu `--noEmit`)** → TS EMIT ~200 `.js/.d.ts` đè vào `src/`. KHÔNG phải "agent ghi tay stub". **CẢ CMD_BUILD LẪN AUDIT đều kích hoạt** khi verify bằng `tsc -p` trần. | Không có registry+guard; và LỆNH VERIFY CỦA CHÍNH AUDIT không an toàn (thiếu `--noEmit`) → công cụ kiểm chứng tự gây bug |
| S3b | **Đổ lỗi sai (bài học honesty)**: AUDIT ban đầu kết luận "stub do CMD_BUILD ghi tay, không phải vite" | Kết luận trước khi tái hiện được cơ chế; CMD_BUILD mới là bên điều tra ra emit-trap | Phải tái hiện cơ chế TRƯỚC khi quy trách nhiệm (R9 evidence-first / R10 uncertainty→STOP) |
| S4 | **Gate gốc hỏng**: `npm run typecheck` = `tsc -b --noEmit \|\| tsc --noEmit -p tsconfig.json` (tsconfig.json root KHÔNG tồn tại) → KHÔNG bắt lỗi web | Script viết ẩu từ trước, `\|\|` che lỗi | Lệnh gate "chính thức" không phản ánh sự thật → false-PASS có đất sống |
| S5 | **Không đo lường bug trước**: type-mirror drift (service↔preload) đã có trong memory nhưng không được liệt kê thành gate phòng ngừa trước khi dispatch | Dispatch phản ứng, không dự báo | Thiếu bước "đo lường trước bug" trong khung prompt |

## PHẦN 2 — HARDLOCK ĐÃ THI HÀNH (vật lý, không chỉ ghi nhớ)

- **Guard**: `tools/audit/protected_artifacts_guard.mjs` + registry `tools/audit/protected_artifacts.json` — 3 lớp: sàn số dòng, %thu-nhỏ-so-HEAD, anchor bắt buộc. Đã tự-kiểm-thử: PASS thật / FAIL clobber.
- **Hook**: `.githooks/pre-commit` chạy guard, `core.hooksPath=.githooks`. Đã test: commit file clobber **BỊ CHẶN**.
- **Gate sửa**: root `npm run typecheck` → gate thật node+web; thêm `npm run audit:protected` + `npm run verify` (typecheck+guard+test một phát).
- Khắc phục S4 tại gốc: lệnh typecheck chính thức giờ = `tsc node + tsc web`.

## PHẦN 3 — KHUNG PROMPT CHUẨN (mọi dispatch CMD_BUILD phải có đủ 5 khối)

**① Ràng buộc vai + repo**
- Chỉ sửa ổ D. CẤM đụng bản C. CẤM git commit/tag/push (chỉ LEAD).
- CMD_BUILD = builder; KHÔNG tự quyết scope; gặp bất định → DỪNG, hỏi, KHÔNG đoán.

**② Đo lường trước bug (BẮT BUỘC — điền trước khi giao)**
Liệt kê lớp bug dự báo cho frame này + gate phòng ngừa từng lớp. Thư viện lớp bug đã biết của dự án:
- `type-mirror-drift`: DTO ở `preload/index.d.ts` lệch service → gate: web typecheck 0 + guard.
- `clobber-hand-maintained`: ghi đè file tay → gate: `audit:protected` PASS + "Edit không Write".
- `tool-built-not-wired`: viết hàm nhưng chưa nối IPC/preload/UI → gate: selftest chạy qua đúng đường IPC.
- `test-orphan`: đổi rule nhưng test cũ còn khẳng định rule cũ → gate: regression phải xanh SAU khi cập nhật test theo invariant mới.
- `db-evolution-gap`: quyền/schema mới không áp cho data cũ → gate: test trên DB đã tiến hóa, không chỉ DB throwaway.
- `spec-silently-unimplemented`: mục spec (vd push thông báo §4.2/4.3) bị bỏ âm thầm → gate: checklist spec-vs-impl.
- `emit-trap`: `tsc -p` trần (thiếu `--noEmit`) phun `.js/.d.ts` đè `src/` → gate: verify LUÔN dùng `--noEmit`; tsconfig có `outDir` vứt-đi; guard `audit:protected`.

**Luật vàng cho công cụ verify:** MỌI lệnh typecheck của AUDIT phải qua `npm run typecheck` (đã `--noEmit`) HOẶC `tsc --noEmit -p ...`. **CẤM `tsc -p` trần** — chính nó là cạm bẫy S3. Sau mỗi lần verify: `git status` + `audit:protected` để chắc không phun rác/không clobber.

**③ File được bảo vệ** (KHÔNG Write đè, chỉ Edit chèn): xem `protected_artifacts.json`. Sau khi sửa phải `npm run audit:protected` PASS.

**④ Bằng chứng máy-kiểm (agent tự-báo KHÔNG được tính là bằng chứng)**
CMD_BUILD dán output THÔ. Nhưng **AUDIT sẽ chạy lại 100% gate từ trạng thái sạch** và chỉ tin số của AUDIT:
- `npm run typecheck` (node+web) = 0
- `npm run build` = 0
- `npm run test` (vitest) ≥ baseline
- selftest liên quan (B09) = pass đủ / fail 0
- regression frame trước = xanh
- `npm run audit:protected` = PASS

**⑤ Báo cáo**: file đổi + output thô từng gate + mọi chỗ suy luận (đánh dấu) + KHÔNG commit.

## PHẦN 4 — LUẬT AUDIT (Claude tự ràng)
1. **KHÔNG bao giờ nhận số gate do CMD_BUILD báo.** Chạy lại độc lập từ trạng thái sạch. (S2)
2. **KHÔNG tự viết feature/test code** thay CMD_BUILD. Builder hết phiên → spawn mới hoặc chờ. (S1)
3. **Đo lường trước bug** trước mỗi dispatch (khối ②). (S5)
4. Mỗi bug bắt được = **thất bại quy trình** → thêm gate/guard/test + ghi `BUGS_FIXED.md` trước freeze. (TỐI THƯỢNG GLOBAL)
5. Trước freeze bất kỳ frame: `npm run verify` + selftest + regression + `audit:protected` đều xanh do AUDIT tự chạy.
