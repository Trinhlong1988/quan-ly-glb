# PING CLAUDE â€” MASTER AUDIT Äá»I KHÃNG

Repo: `D:\TT HKD AI\tools\quan-ly-glb`  
NgÃ y: 2026-07-15  
Pháº¡m vi: backend/auth, quan há»‡ dá»¯ liá»‡u, frontend vÃ  red-team cá»§a hai phiÃªn audit.

## Quy táº¯c chá»‘ng bÃ¡o cÃ¡o sai

Claude pháº£i tá»± kiá»ƒm chá»©ng tá»«ng ID báº±ng agent Ä‘á»™c láº­p. Má»—i ID pháº£i ghi `REPRODUCED`, `REJECTED` hoáº·c `CONDITIONAL`, kÃ¨m command/test, exit-code, dá»¯ liá»‡u trÆ°á»›câ€“sau vÃ  regression test. KhÃ´ng cháº¥p nháº­n pháº£n bÃ¡c â€œUI khÃ´ng gá»i váº­yâ€. KhÃ´ng sá»­a theo suy Ä‘oÃ¡n.

Gate hiá»‡n táº¡i: `npm run verify` exit 0 (266 test), `npm run build` exit 0; `npm run lint` exit 1 vÃ¬ khÃ´ng cÃ³ script lint. CÃ¡c gate nÃ y khÃ´ng phá»§ race, timezone, GUI vÃ  quan há»‡ DB.

## I. Lá»—i Ä‘Ã£ Ä‘Æ°á»£c chá»©ng minh báº±ng code path

### AUTH-01 â€” PhiÃªn sá»‘ng giá»¯ quyá»n sau khi thu há»“i (Ä‘Ã£ thu háº¹p pháº¡m vi)

Äá»‘i chá»©ng backend má»›i cho tháº¥y cÃ¡c mutation guard chÃ­nh hiá»‡n Ä‘Ã£ gá»i `validateCurrentSession` vÃ  refresh status/roles; **khÃ´ng Ä‘Æ°á»£c tiáº¿p tá»¥c bÃ¡o cÃ¡o lá»—i tá»•ng quÃ¡t nÃ y náº¿u chÆ°a tÃ¡i hiá»‡n**. Lá»—i cÃ²n báº±ng chá»©ng á»Ÿ `global-search-service.ts:31` (`const actor = me()`) vÃ  `ipc.ts:163`: global search khÃ´ng gá»i `validateCurrentSession`; `auth:me` táº¡i `ipc.ts:74` cÅ©ng tráº£ snapshot. Sau khi session bá»‹ xÃ³a/revoke, search váº«n cÃ³ thá»ƒ tráº£ dá»¯ liá»‡u hoáº·c renderer váº«n nháº­n roles cÅ©. Tráº¡ng thÃ¡i: `STATIC_PROOF; NEEDS_RUNTIME`.

### AUTH-07 â€” Global search dÃ¹ng snapshot thay vÃ¬ session authoritative (High)

`global-search-service.ts:31` láº¥y `me()` thay vÃ¬ `validateCurrentSession`; IPC `search:global` táº¡i `ipc.ts:163` gá»i tháº³ng. TÃ¡i hiá»‡n cáº§n mock/xÃ³a session DB sau login rá»“i gá»i query `KH`; expected NOT_AUTHENTICATED/FORBIDDEN, actual cÃ³ nguy cÆ¡ tráº£ customer/TID/POS/transaction theo snapshot. KhÃ´ng claim runtime REPRODUCED khi chÆ°a cÃ³ DB test.

### AUTH-02 â€” `user:update` bypass khÃ³a user/Admin cuá»‘i (Critical)

`user-service.ts:257-260,271-290,311-322` chá»‰ yÃªu cáº§u `USER_UPDATE`, nháº­n `input.status`; guard Ä‘Ãºng á»Ÿ `:352-377`. IPC `:134-136` nháº­n payload tÃ¹y Ã½. Actor quyá»n tháº¥p cÃ³ thá»ƒ gá»­i LOCKED/DISABLED cho Admin cuá»‘i.

### AUTH-03 â€” DISABLED/PENDING session váº«n dÃ¹ng Ä‘Æ°á»£c (High)

`auth-service.ts:317-329` khÃ´ng revoke hai status; login má»›i chá»‰ cháº·n á»Ÿ `auth.rules.ts:34-40,92-95`.

### AUTH-04 â€” IPC Ä‘á»•i PostgreSQL khÃ´ng auth (Critical)

`ipc.ts:55-57`, `db.ts:976-981,997-1007,1045-1054`: renderer cÃ³ thá»ƒ Ä‘á»•i host/credential, gÃ¢y DoS hoáº·c gá»­i credential tá»›i DB giáº£. First-run khÃ´ng Ä‘Æ°á»£c má»Ÿ endpoint sau setup.

### AUTH-05 â€” Race khÃ³a/xÃ³a háº¿t Admin (High)

Count vÃ  update tÃ¡ch rá»i `user-service.ts:116-125,362-377,404-418`; hai client Ä‘á»“ng thá»i cÃ³ thá»ƒ cÃ¹ng vÆ°á»£t kiá»ƒm tra last-admin.

### AUTH-06 â€” `role:update` bypass ROLE_LOCK/UNLOCK (High)

`role-service.ts:116-153` cho phÃ©p status qua `ROLE_UPDATE`; endpoint Ä‘Ãºng táº¡i `:172-189` má»›i Ä‘Ã²i quyá»n khÃ³a/má»Ÿ.

### SEC-01 â€” PostgreSQL password plaintext (High)

`db.ts:500-518,1046-1051` ghi password rÃµ vÃ o server-config JSON, trong khi remember credential dÃ¹ng safeStorage (`remember.ts:18-21,43-45`).

### SEC-02 â€” Restore khÃ´ng báº¯t buá»™c kiá»ƒm tra toÃ n váº¹n (High)

`backup-service.ts:401-410` cho phÃ©p thiáº¿u manifest/checksum; `:412-435` cháº¡y `pg_restore --clean`. ZIP dump bá»‹ thay váº«n restore Ä‘Æ°á»£c.

### FE-01 â€” Export máº¥t ngÃ y/giá» nháº­p (High)

`ExportRequestPanel.tsx:259-261` cÃ³ `reqDate/reqTime`, nhÆ°ng payload `:308-323` khÃ´ng gá»­i hai field; IPC `:325` dÃ¹ng máº·c Ä‘á»‹nh. Chá»n ngÃ y 2000 rá»“i Ä‘á»c DB lÃ  báº±ng chá»©ng trá»±c tiáº¿p.

### FE-02 â€” Reset filter dÃ¹ng closure cÅ© (Medium)

`CustomersPage.tsx:91-96` set state rá»—ng rá»“i `setTimeout(reload,0)`; callback dÃ¹ng state render cÅ©. CÃ¹ng pattern xuáº¥t hiá»‡n á»Ÿ nhiá»u FilterBar.

### FE-03 â€” IPC reject lÃ m loading treo (High/Medium)

Customers `:69-84`, Staff `:73-79`, Pos `:135-149`, CashEntry `:85-100`, Revenue `:161-185`, Debt `:102-112`, Dashboard refresh `:461` thiáº¿u `try/finally`. Mock má»™t API reject: spinner khÃ´ng táº¯t.

### FE-04 â€” Lá»c ngÃ y lá»‡ch timezone (High/Medium)

`RevenuePage.tsx:132-145`, `DebtPage.tsx:72-78` dÃ¹ng `new Date(date+'T00:00:00').toISOString()`. Asia/Saigon biáº¿n ngÃ y 15 thÃ nh UTC ngÃ y 14 17:00.

### FE-05 â€” POS nháº­n Infinity/sai sá»‘ tiá»n (High)

Red-team xÃ¡c nháº­n vá»‹ trÃ­ Ä‘Ãºng `TidPage.tsx:662`: `Number(salePrice)||0`; `Infinity` vÆ°á»£t kiá»ƒm tra `>0`, sá»‘ >2^53 bá»‹ lÃ m trÃ²n.

### FE-06 â€” Export approval dÃ¹ng POS/TID stale (High)

`ExportApprovalPage.tsx:210-228` táº£i/lá»c danh sÃ¡ch má»™t láº§n á»Ÿ renderer; client khÃ¡c cÃ³ thá»ƒ thay Ä‘á»•i tÃ i sáº£n trÆ°á»›c submit. Backend pháº£i recheck transaction.

### FE-07 â€” Modal Enter bypass validation/busy, double-submit (High)

`components/Modal.tsx:39-49` gá»i `onSubmit` trá»±c tiáº¿p khi Enter; khÃ´ng biáº¿t busy/native validation. NÃºt X `:53-55` thiáº¿u `type=button`.

### FE-08 â€” Update cháº¡y nhiá»u láº§n (High)

`UpdateBanner.tsx:65-68,75-77` khÃ´ng guard phase/busy; click nhanh gá»i nhiá»u start/install.

### FE-09 â€” MessagesDrawer bÃ¡o thÃ nh cÃ´ng giáº£ (Medium)

`MessagesDrawer.tsx:46-73` khÃ´ng kiá»ƒm `res.ok`, váº«n local-update/toast khi mark-read/mark-all tháº¥t báº¡i; reload cÅ©ng cÃ³ race.

### FE-10 â€” Attachment hiá»ƒn thá»‹ áº£nh cÅ© (Medium)

`Attach.tsx:9-13` khÃ´ng sequence/cancel vÃ  khÃ´ng clear URL khi path má»›i lá»—i. Promise A tráº£ sau B ghi/giá»¯ áº£nh A.

### FE-11 â€” Realtime ACK trÆ°á»›c reload (Medium)

`lib/realtime.tsx:54-56,61-73`: ACK trÆ°á»›c `onReload`; reload fail lÃ m banner biáº¿n máº¥t khi báº£ng cÃ²n cÅ©.

### FE-12 â€” Realtime BigInt token máº¥t chÃ­nh xÃ¡c (High khi token lá»›n)

`main/realtime-service.ts:23` dÃ¹ng `Number(t.version)`; hai BigInt khÃ¡c nhau trÃªn 2^53 cÃ³ thá»ƒ bá»‹ coi báº±ng nhau.

### DATA-01 â€” Export TID SALE khÃ´ng chuyá»ƒn SOLD (Critical)

`export-request-service.ts:416-455` nhÃ¡nh **TID direct SALE** táº¡o DeviceSale/cash nhÆ°ng chá»‰ cáº­p nháº­t delivered/customer/agent, khÃ´ng set `Tid.status='SOLD'`. TrÃ¡i `docs/POS_SALE_DEBT_SPEC.md:29-31`.

Red-team Ä‘Ã£ pháº£n bÃ¡c pháº¡m vi rá»™ng hÆ¡n: POS bÃ¡n kÃ¨m TID cÃ³ nhÃ¡nh set SOLD Ä‘Ãºng; chá»‰ giá»¯ lá»—i direct Export TID SALE.

### DATA-12 â€” BigInt bá»‹ Ã©p Number trong aggregate/settlement (High, Ä‘Ã£ dá»±ng báº±ng pure JS)

`dashboard-service.ts:115-116`, `transaction-service.ts:444-447,493-499,560-563,660-661`, `cash-entry-service.ts:485,502,531,535-536,617-623`, `approval-service.ts:402`, `health-scan.ts:52-53,150-151` Ã©p BigInt/aggregate sang Number. `Number(9007199254740993n) === 9007199254740992` chá»©ng minh máº¥t 1 Ä‘á»“ng; debt remaining, dashboard, approval vÃ  health scan cÃ³ thá»ƒ sai. Existing money-string guard khÃ´ng bao phá»§ cÃ¡c aggregate/variable conversion. Tráº¡ng thÃ¡i: `REPRODUCED_STATIC/PURE_JS`; cáº§n integration DB Ä‘á»ƒ chá»©ng minh tÃ¡c Ä‘á»™ng tá»«ng mÃ n hÃ¬nh.

### DATA-12 â€” BigInt bá»‹ Ã©p Number trong aggregate/settlement (High)

`dashboard-service.ts:115-116`, `transaction-service.ts:444-447,493-499,560-563,660-661`, `cash-entry-service.ts:485,502,531,535-536,617-623`, `approval-service.ts:402`, `health-scan.ts:52-53,150-151` Ã©p BigInt sang Number. Pure JS chá»©ng minh `Number(9007199254740993n)` thÃ nh `9007199254740992`; dashboard, debt, approval vÃ  health scan cÃ³ thá»ƒ sai 1 Ä‘á»“ng. Tráº¡ng thÃ¡i `REPRODUCED_STATIC/PURE_JS`; cáº§n integration DB cho tá»«ng mÃ n hÃ¬nh.

### DATA-13 â€” Transaction cho phÃ©p customer khÃ¡c customer cá»§a TID (Conditional)

`transaction-service.ts:247-269` chá»‰ kiá»ƒm customer input tá»“n táº¡i, khÃ´ng buá»™c báº±ng `tid.customerId`. CÃ³ thá»ƒ táº¡o transaction `tidId=A(customer=1), customerId=2`, lÃ m bÃ¡o cÃ¡o TID vÃ  cÃ´ng ná»£ lá»‡ch chá»§ thá»ƒ. Pháº£i Ä‘á»‘i chiáº¿u spec vá» backdated reassignment rá»“i dá»±ng fixture hai customer.

### DATA-14 â€” TOCTOU giá»¯a validate TID vÃ  insert (Conditional)

Refs Ä‘Æ°á»£c Ä‘á»c trÆ°á»›c transaction táº¡i `transaction-service.ts:247-269`, transaction báº¯t Ä‘áº§u khoáº£ng `:274`; writer khÃ¡c cÃ³ thá»ƒ Ä‘á»•i/xÃ³a má»m TID sau validate trÆ°á»›c insert. Cáº§n deferred PostgreSQL test; khÃ´ng claim runtime náº¿u chÆ°a cháº¡y.

### SEC-03 â€” ZIP parser thiáº¿u CRC/bounds/duplicate validation (Conditional)

`zip.ts` Ä‘á»c local headers, khÃ´ng kiá»ƒm CRC/bounds/central-directory/duplicate names; `restoreBackup` chá»n entry báº±ng `find`. Cáº§n crafted ZIP vÃ  output `pg_restore`; Ä‘Ã¡nh dáº¥u conditional vÃ¬ `pg_restore` cÃ³ thá»ƒ cháº·n payload há»ng.

## II. Lá»—i cáº§n kiá»ƒm chá»©ng, khÃ´ng Ä‘Æ°á»£c bÃ¡o cháº¯c cháº¯n mÃ¹

1. **Thiáº¿u FK nghiá»‡p vá»¥:** schema chá»§ Ã½ dÃ¹ng scalar/event-log (â€œno hard FKâ€). Chá»‰ gá»i bug náº¿u raw SQL/restore táº¡o orphan vÃ  khÃ´ng cÃ³ scanner/reconcile báº£o vá»‡.
2. **Status TEXT khÃ´ng CHECK:** cáº§n Ä‘á»‘i chiáº¿u spec vÃ  cháº¡y SQL/import; náº¿u service + health scan báº£o vá»‡ Ä‘áº§y Ä‘á»§ thÃ¬ ghi design trade-off.
3. **Tráº¡ng thÃ¡iâ€“quan há»‡ mÃ¢u thuáº«n:** pháº£i cháº¡y SQL vÃ  chá»©ng minh khÃ´ng cÃ³ guard/health scan á»Ÿ má»i writer.
4. **TID lá»‡ch customerId/dossierId/hkdName:** chá»‰ káº¿t luáº­n sau khi spec chá»n nguá»“n sá»± tháº­t vÃ  query UI/report hiá»ƒn thá»‹ ba chá»§ thá»ƒ khÃ¡c nhau.
5. **Soft-delete Customer bá» sÃ³t con:** pháº£i xÃ¡c Ä‘á»‹nh policy lá»‹ch sá»­ (restrict/snapshot/archive) rá»“i má»›i káº¿t luáº­n.
6. **Live unique chá»‰ enforce service:** pháº£i cháº¡y hai transaction PostgreSQL Ä‘á»“ng thá»i Ä‘á»ƒ chá»©ng minh duplicate sá»‘ng.
7. **BigInt summary Ã©p Number:** cháº¡y amount `9007199254740993` vÃ  so sÃ¡nh DB/DTO trÆ°á»›c khi claim.
8. **txnDate timezone:** kiá»ƒm migration column type vÃ  hai session timezone, khÃ´ng káº¿t luáº­n chá»‰ nhÃ¬n Prisma.
9. **moneyKind cast mÃ¹:** chá»‰ xáº£y ra khi raw SQL/import ghi giÃ¡ trá»‹ BOGUS; pháº£i cháº¡y tamper fixture.
10. **customerDeviceSerial null:** chÆ°a chá»©ng minh báº¯t buá»™c cho má»i mode; chá»‰ nÃ¢ng má»©c náº¿u spec yÃªu cáº§u.
11. **DateInput khÃ´ng sync prop:** chá»‰ lá»—i náº¿u test giá»¯ component mounted, Ä‘á»•i prop Aâ†’B vÃ  submit váº«n A.

## III. CÃ¡c pháº£n biá»‡n Ä‘Ã£ Ä‘Æ°á»£c ghi nháº­n

- KhÃ´ng bÃ¡o â€œsecret committedâ€: `.env` local bá»‹ ignore, khÃ´ng tracked.
- KhÃ´ng dÃ¹ng mojibake PowerShell lÃ m báº±ng chá»©ng source há»ng encoding.
- KhÃ´ng gÃ¡n lá»—i POS bÃ¡n kÃ¨m cho nhÃ¡nh Export TID direct Ä‘Ã£ Ä‘Æ°á»£c phÃ¢n biá»‡t.
- KhÃ´ng gá»i thiáº¿u FK lÃ  lá»—i cháº¯c cháº¯n khi constitution/spec cho phÃ©p event-log scalar.
- FE-05 dÃ¹ng vá»‹ trÃ­ Ä‘Ã£ red-team xÃ¡c nháº­n `TidPage.tsx:662`, khÃ´ng dÃ¹ng nháº§m dÃ²ng cÅ©.

## IV. YÃªu cáº§u Claude Ä‘iá»n báº±ng chá»©ng

| ID | REPRODUCED/REJECTED/CONDITIONAL | Command/test + exit-code | Dá»¯ liá»‡u trÆ°á»›câ€“sau | Sá»­a + regression |
|---|---|---|---|---|
| AUTH-01â€¦AUTH-06 | báº¯t buá»™c tá»«ng dÃ²ng | báº¯t buá»™c | báº¯t buá»™c | báº¯t buá»™c |
| SEC-01â€¦SEC-02 | báº¯t buá»™c tá»«ng dÃ²ng | báº¯t buá»™c | báº¯t buá»™c | báº¯t buá»™c |
| FE-01â€¦FE-12 | fake Promise/tz/IPC tháº­t | báº¯t buá»™c | báº¯t buá»™c | báº¯t buá»™c |
| DATA-01â€¦DATA-11 | SQL/spec/selftest | báº¯t buá»™c | báº¯t buá»™c | báº¯t buá»™c |

## Äiá»u kiá»‡n PASS

KhÃ´ng Ä‘Æ°á»£c claim PASS chá»‰ vÃ¬ typecheck/build xanh. Pháº£i xá»­ lÃ½ cÃ¡c lá»—i Ä‘Ã£ chá»©ng minh, cháº¡y regression/concurrency/timezone/BigInt tests, vÃ  lÆ°u command/output cho má»i má»¥c bá»‹ pháº£n bÃ¡c. ÄÃ¢y lÃ  file master duy nháº¥t Ä‘á»ƒ Claude Ä‘á»‘i chá»©ng hai phiÃªn audit vÃ  trÃ¡nh tÃ¡i diá»…n bÃ¡o cÃ¡o sai.

