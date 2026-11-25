# 917. ERP 연결 ③ — 묶음 8 내부 API(회계 옮김 의존) · 관 점검 끝내기 고침 — v10.801 (2026-11-26)

## 1. 결론

- ERP 로 옮긴 회계 코드(ERP docs/011 2절)가 부르는 소개뱅크 내부 길 **14개**를 만들었습니다. 모두 **ERP 서비스 토큰(`X-Erp-Service-Token` · `ErpLinkGuard`)** 으로만 열립니다(v10.799 · 800 과 같음).
- 대표 11/26 「연동 키는 소개뱅크가 대신 호출」 — AI 키 · 국세청 키 · SMTP · 전자세금계산서 업체 키 · 금융결제원 키는 **소개뱅크에만** 있습니다. ERP 는 결과만 받습니다.
- **대량 이체(`transfer/send`)는 만들지 않고 501** 로 둡니다 — 이체 안전장치가 묶음 표(acct_transfer_*)와 한 흐름이라 「보내기」만 떼면 소개뱅크가 승인을 확인할 수 없습니다(4절 설계).
- 마이그레이션 **없음**(D335 안 씀) — 내부 길은 주소 표(perm_route_map)에 넣지 않습니다(v10.799 · 800 의 `/internal/erp/*` 와 같은 방식). 하루 셈은 메모리.
- 함께: ERP 알림 종류에 **`STOCK_`**(재고) 더함 · **관 점검 「지금 끝내기」 바로 다시 열기** 고침.

## 2. 내부 길 (모두 `/api/v1/internal/erp/…` · 서비스 토큰)

| 길 | 요청 | 응답 | 소개뱅크가 하는 일 | 막는 것 |
|---|---|---|---|---|
| `POST export/consume` | `{ id, target, accountId }` | `{ ok, ticket }` | `export_requests.used_at` — 대상 · 요청자 · APPROVED · 24시간 · 안 씀을 **한 UPDATE** 로(ExportApprovalService.check + use) · 감사 `ERP_EXPORT_CONSUME` | 대상은 ERP 업무만(ACCT_JOURNAL · ACCT_TAX · ACCT_LEDGER · ACCT_ARCHIVE · HRA_PAY_FILE · ITS_SURVEY) · 쓴 것 409 `EXPORT_TICKET_USED` · 그 밖 422 `EXPORT_NEED_APPROVAL` |
| `POST agent/allowed` | `{ kind }` | `{ ok, reason }` | `AgentService.allowed`(fn_agent_allowed · 스위치 · 월 상한) | 통로 `RECEIPT` 만 |
| `GET agent/provider` | — | `{ name \| null }` | 엔진 이름(MOCK · CLAUDE) | 키 값 · 끝 4자리도 안 보냄 |
| `POST agent/complete` | `{ model, system, maxTokens, effort, messages }` | `{ text, model, inputTokens, outputTokens, cacheReadTokens }` | allowed 다시 봄 → 엔진 → **사용량 여기서 쌓음**(fn_agent_record_usage) | 글 · 사진(JPG · PNG base64) 조각만 · 사진 한 장 · 메시지 4개 · maxTokens 2,000 · 본문 **8MB**(이 주소만 · 토큰 머리 있을 때만) · 하루 500번 · 엔진 오류 글은 넘기지 않음(502 `ERP_AGENT_FAILED`) |
| `POST agent/record` | `{ kind, model, inTok, outTok, cacheRead }` | `{ ok, recorded:false }` | **받기만** — complete 가 이미 쌓음(두 번 세지 않음) | 통로 `RECEIPT` 만 |
| `GET files/{id}/content?purpose=` | — | 파일 바이트(Content-Type) | `files` READY · 용도 맞음 → 저장소(storageFromEnv) 열기 | 용도 `ACCT_EVIDENCE` 만 · 그 밖 404 |
| `POST biz-status` | `{ bizRegNo }` | `BizStatusResult` `{ status, stub, detail? }` | `resolveBizStatusProvider().check`(키 없으면 간주) | 숫자 10자리(- 빼고) · 하루 2,000번 |
| `GET mail/ready` | — | `{ ready }` | `MailService.ready`(설정 · notify.email_verified) | — |
| `POST mail` | `{ to, subject, text, html? }` | `{ ok, messageId?, errorKind? }` | 준비 안 됨이면 **보내지 않고** `ok:false · NOT_READY` · `MailService.send` · 감사 `ERP_MAIL_SEND`(주소 가림) | 받는 주소 **하나**(쉼표 · 세미콜론 · 꺾쇠 안 됨) · 제목 줄바꿈 안 됨 · **하루 200통** · html 은 받지만 안 씀(SMTP 글만) |
| `POST etax/send` | `{ slug, id, mode, actorId? }` | EtaxService 응답 그대로 | `EtaxService.send`(간주 · 업체 · 중복 발행 막기 그대로) · 감사 `ERP_ETAX_SEND` | slug `ad · commission · sales-doc · exempt`(acct_tax_invoices 4종) — directory · lead-cash 는 소개뱅크 업무라 404 |
| `POST products/tax-type` | `{ code, taxType, reason, actorId? }` | `{ ok, code, taxType }` | acct.controller `setTaxType` 와 **같은 SQL**(직판 DIRECT 상품만) · 감사 `PRODUCT_TAX_TYPE`(역할 `ERP_SERVICE`) | 사유 2 ~ 200자 · 없거나 직판 아님 404 |
| `POST bank/fetch` | `{ mode, account:{id,label,bankStd,last4,fintech}, from, to }` | `FeedResult` `{ ok, rows[], bad, errorKind?, error? }` | bankfeed 어댑터 `list` 만(간주 · 금융결제원) · 거래고유번호는 소개뱅크 시퀀스 `fn_acct_transfer_tran_id` | 기간 오늘까지 · 31일 · 계좌 모양 · LIVE 키 없으면 422 `BANK_FEED_NOT_READY` · 하루 200번 |
| `POST taxinbox/fetch` | `{ mode, provider?, from, to }` | `InboxResult` `{ ok, items[], … }` | taxinbox 어댑터 `list` 만 | 기간 31일 · LIVE 키 없으면 422 `TAXINBOX_NOT_READY` · 하루 100번 |
| `POST transfer/send` | — | **501** `ERP_TRANSFER_NOT_PROXIED` | 없음(4절) | — |

- 쓰는 길(consume · mail · etax · tax-type)은 `audit.audit_logs` 에 `actor_role = 'ERP_SERVICE'` · 행위자는 ERP 가 알려 준 uuid(없으면 비움).
- 하루 셈(`dailyCap`)은 **API 프로세스 메모리**입니다 — 다시 띄우면 0 부터. 운영 API 는 한 프로세스라 「잘못 돈 반복(메일 폭주 · AI 비용)」을 멈추는 뜻으로 충분하다고 봤습니다. 넘으면 422 `ERP_DAILY_LIMIT`.

## 3. 보안 메모

1. 서비스 토큰 하나가 이 14길을 모두 엽니다 — 토큰은 ERP `.env` 에만 · 바꾸기는 SUPER(외부 연동 › ERP 연동). 의심되면 바로 바꾸면 전 토큰은 즉시 무효.
2. 바깥 키 · 엔진 오류 원문 · 받는 주소 원문은 응답 · 기록에 싣지 않습니다(메일 주소는 앞 2글자만).
3. AI 비용: complete 가 스위치 · 월 상한을 **다시 보고**, 사용량을 **직접 쌓습니다** — ERP 가 allowed · record 를 건너뛰어도 상한이 새지 않습니다.
4. 큰 본문(8MB)은 `agent/complete` 한 주소 · 서비스 토큰 머리가 있을 때만 읽습니다(그 밖은 기본 100KB).
5. bank/fetch 는 핀테크이용번호를 ERP 가 풀어 보냅니다(내부망) — 소개뱅크는 저장 · 기록하지 않습니다.

## 4. 대량 이체 설계 (코드 없음 · 501)

- 지금 `sendTransfer`(acct/transfer.ts)의 안전장치: ① 만든 사람이 아닌 **2명 승인** ② 묶음 잠금 · 상태(APPROVED → CHECKING) ③ 수취조회(이름 다르면 HOLD) ④ **거래고유번호를 먼저 DB 에 저장**한 뒤 입금이체 ⑤ PENDING · 응답 없음은 **다시 보내지 않고** 결과 조회로만 ⑥ 묶음 합계 상한(acct.transfer_max) ⑦ LIVE OK 줄만 전표.
- 이것들은 모두 `acct_transfer_batches · acct_transfer_items` 와 한 흐름입니다. 표가 ERP 로 가고 「입금이체」만 소개뱅크에 두면 소개뱅크는 승인 · 상한 · 거래고유번호 중복을 **볼 수 없어** 서비스 토큰 하나로 돈이 나가는 길이 됩니다.
- 안(대표 결정 필요): **(가)** E7 까지 대량 이체는 소개뱅크 화면에 남김(지금 501 그대로 · 권함) · **(나)** 소개뱅크가 「승인된 묶음 사본」을 받아 2명 승인(소개뱅크 계정) · 상한 · 거래고유번호(소개뱅크 시퀀스 · UNIQUE 표)를 **소개뱅크 쪽 표**에서 다시 확인한 뒤에만 보냄(새 표 `erp_transfer_relay` · 줄마다 bank_tran_id UNIQUE · 결과 조회 길 따로) · **(다)** 이체를 ERP 로 통째로 옮기고 금융결제원 키 · 발신 IP 를 ERP 서버에 둠(대표 11/26 결정과 다름).

## 5. 할 일 (TODO)

1. **etax (E7)** — `acct_tax_invoices` 가 ERP 로 가면 `etax/send` 는 소개뱅크 표를 못 읽음 → `POST etax/call { action, kind, docKey, doc }`(문서를 받아 업체 전송 · `etax_send_log` 만 · plan_e3_deps 3절)로 바꿈. 코드에 TODO 표시.
2. ERP `core/sgb-client.ts` 기본 시간 제한 **5초** — `agent/complete`(사진 · AI)는 5초를 넘기 쉬움 → ERP 쪽에서 이 길만 60초로(ERP 갈래 일).
3. ERP 내려받기 대상이 늘면 `ERP_EXPORT_TARGETS` 에 더함.
4. 하루 셈을 DB 로 옮길지(API 를 여러 프로세스로 띄우게 되면) — 그때 마이그레이션.
5. Nginx 를 거쳐 부르게 되면 `agent/complete` 주소에 `client_max_body_size 8m` 필요(지금은 ERP 가 API 를 바로 부르는 것으로 가정 · 확인 필요).
6. 대량 이체 4절 (가) · (나) · (다) 대표 결정.

## 6. 함께 고친 것

| 항목 | 내용 |
|---|---|
| ERP 알림 종류 | `ERP_ALERT_RE` · DTO 에 `STOCK_` 더함(ERP 재고 `STOCK_NEGATIVE` · `STOCK_REORDER` — ERP docs/011 4절 4) |
| 관 점검 지금 끝내기 | `end()` 가 끝 시각을 `greatest(starts_at + 1초, now())` 로 둔 뒤 바로 `tick()` — 시작 직후면 끝 시각이 1초 미래라 「`ends_at <= now()`」 에 안 걸려 1분 뒤 차례까지 닫혀 있던 것 → `tick(forceEndId)` · 다시 열 줄 조회를 `ends_at <= now() OR id = $1` 로(그 점검만 · 정기 작업은 그대로) |

## 7. 바뀐 파일

| 파일 | 내용 |
|---|---|
| `src/modules/erp-link/erp-internal-more.ts` | 새 · 14길 처리 · 하루 셈 · 감사 |
| `src/modules/erp-link/erp-link-more.controller.ts` | 새 · DTO · 컨트롤러 `ErpLinkMoreController` · `ErpLinkMoreService` |
| `src/modules/erp-link/erp-internal.ts` · `erp-link.controller.ts` | `STOCK_` |
| `src/modules/site/gwan-maint.service.ts` | `tick(forceEndId?)` |
| `src/common/security-headers.ts` | `agent/complete` 본문 8MB |
| `src/app.module.ts` | 등록 |
| `src/common/i18n/server-text.en.ts` | 영어 14문장 |
| `spec/screens.json` | SB-ADM-ERP-010 에 내부 길 14 |
| `VERSION` | v10.801 |
- 시험(qa)은 sgb-infra 쪽 따로(다른 일).
