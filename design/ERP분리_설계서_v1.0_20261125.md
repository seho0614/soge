# ERP 분리 설계서 v1.0 (대표 승인 2026-11-25) — 2026-11-25

> 대표 11/25 「ERP 확장 개발 · 설계 변경」 → ERP 를 **소개뱅크와 별도 시스템으로 분리**.
> 정한 것: 기존 회계 · 세무 · 급여 · 매입 · 재고는 ERP 로 **옮김** · 로그인은 **소개뱅크 운영자 계정(한 번 로그인)** · DB 는 **같은 RDS 안 다른 데이터베이스** · 서버는 운영 서버 재설계 때 · 새 저장소 `sgb-erp`(Claude 가 aws CLI 로 만듦).
> **11/25 대표 「승인」 · 9절 네 가지 모두 추천대로**(포트 13100 · 15175 · erp.sogaebank.com · 백오피스 함께 · 옛 표는 2 ~ 4주 뒤 따로 승인) — 결정 기록 `decisions/erp-separation.md` · E1 부터 시작.
> 비용 · AWS 기능 지원 여부(특히 RDS 의 postgres_fdw) · 관세청 전자 신고 조건은 **적용 전 확인 필요**로 표시했습니다.

## 1. 결론

| 항목 | 설계 |
|---|---|
| 무엇을 옮기나 | 운영 화면의 회계 · 세무 · 인사 · 사무(acct · hr · hra · hrx · ofc 132표) + 그 표를 가리키는 백오피스(품질 qlt · 법무 lgl · 자산 its · 인사 평가 prr · 영업 기회 sal 37표) = **표 169개 · 서버 코드 약 2만 줄 · API 약 380개 · 화면 17개 · 정기 작업 23개** |
| 무엇이 남나 | 소개뱅크 서비스(회원 · 매물 · 거래 · 소개몰 · 정산 · 광고 · 운영 화면 나머지) + **ERP 로 자료 보내는 길** |
| 로그인 | ERP 화면은 소개뱅크 운영자 로그인을 그대로 씀 — ERP 서버가 소개뱅크 API 에 「이 토큰 누구 · 무슨 권한」을 물어 확인(비밀 키를 나눠 갖지 않음 · 1분 캐시) |
| 권한 | 업무별 권한(perm 그룹 · task)은 소개뱅크 한 곳에 그대로 — ERP 업무 키(acct · hr …)도 거기서 줌 |
| DB | 같은 RDS 인스턴스 안 새 데이터베이스 `sgb_erp` · 소개뱅크 자료(회원 · 판매자 · 상품 · 주문 · 정산 등 33표)는 **읽기 전용 외부 표**(postgres_fdw · `svc` 스키마)로 읽음 — RDS 지원 · 권한 **확인 필요** · 안 되면 4-3 B안 |
| ERP → 소개뱅크 | 운영 알림 · 화면 알림은 소개뱅크 내부 API 로 보냄(쓰기 길은 이것 하나) |
| 화면 주소 | `erp.sogaebank.com`(운영 화면처럼 허용 IP 에서만) · 운영 화면 메뉴의 회계 · 인사는 ERP 로 가는 링크로 바뀜 |
| 저장소 · 판 | `sgb-erp`(CodeCommit 서울) · 판 번호 `e1.0`부터 따로 · 킷 · 점검 · 백업 방식은 소개뱅크와 같게 |
| 옮기는 방식 | 코드는 복사해 고침 → 자료는 운영 반영 때 한 번에 복사(대조 숫자 확인) → **소개뱅크 쪽 옛 표는 바로 지우지 않음**(되돌리기용 · 지우기는 나중에 따로 승인) |
| 판 수 어림 | ERP 약 25 ~ 35판 + 소개뱅크 정리 5 ~ 8판 — 지금 속도로 3 ~ 5일(어림) |

## 2. 지금 상태 (코드에서 센 숫자 · 11/25)

| 구분 | 숫자 |
|---|---|
| ERP 표 | acct 97 · hr 11 · hra 10 · hrx 8 · ofc 6 = 132 |
| 함께 옮길 백오피스 표 | qlt 11 · lgl 10 · its 9 · prr 5 · sal 2 = 37 |
| ERP 표 → 소개뱅크 표 외래 키 | accounts 143 · hlt_product_options 9 · files 3 · hlt_products · advertisers · hlt_sellers · corp_docs 각 1 |
| 소개뱅크 표 → ERP 표 외래 키 | bzx_card_notices → acct_card_txns 1(나머지 17은 함께 옮길 백오피스) |
| ERP 코드가 읽는 소개뱅크 표 | 33개 — 많이 쓰는 순 ops_alerts 82 · accounts 78 · site_settings 66 · hlt_sellers 23 · account_roles 19 · hlt_products 18 · files 18 · hlt_product_options 16 · ad_invoices · advertisers 8 · point_cashouts 6 · hlt_settlements 5 · hlt_orders · hlt_order_items 4 … |
| 서버 | 컨트롤러 14 · API 약 382 · 정기 작업 23(acct_journal · acct_stock · hra_daily …) |
| 화면 | Acct · AcctBooks · AcctExtra · AcctFilings · AcctOps · Erp · Hr · HrCard · HrPeople · Hra · Hrx · MyHrCard · Ofc · Office · Its · PrrStaff · Sales |
| 시험 | acct · hr 관련 판 시험(v10.381 ~ 600대 다수) — ERP 저장소 qa 로 옮김 |

## 3. 전체 구조

```
[운영자 브라우저 · 허용 IP]
   ├─ admin.sogaebank.com ── 소개뱅크 API ── DB sgb (그대로)
   │        └ 회계 · 인사 메뉴 = erp 로 가는 링크
   └─ erp.sogaebank.com ──── ERP API ────── DB sgb_erp (새로 · 같은 RDS)
                               │  ├ 로그인 확인: GET 소개뱅크 /api/v1/auth/introspect (1분 캐시)
                               │  ├ 읽기: svc.* 외부 표(소개뱅크 33표 · 읽기 전용 DB 사용자)
                               │  └ 쓰기: POST 소개뱅크 /api/v1/internal/erp/alerts · notify (서비스 토큰)
                               └ 첨부 파일: ERP 자기 저장소(서버 디스크 → 재설계 때 S3)
```

## 4. 핵심 설계

### 4-1. 로그인 · 권한 (운영자 계정 한 번 로그인)
1. ERP 화면은 소개뱅크 로그인 화면으로 보냄 → 돌아올 때 같은 토큰(쿠키 도메인 `.sogaebank.com` 또는 짧은 교환 코드).
2. ERP API 는 요청마다 토큰을 소개뱅크 `introspect`(새 API · 운영자 · 2단계 인증 완료 · 권한 task 목록 · 끝 시각)에 물음 → 1분 캐시.
3. 권한 판정 키는 지금 그대로(acct · hr · gwan-ux …) — ERP 가 같은 규칙 표로 판정. 권한 주소 표(perm_route_map)의 ERP 줄은 ERP 로 옮김.
4. 비밀 키 공유 없음(소개뱅크 JWT 키를 ERP 에 두지 않음) · 소개뱅크가 멈추면 ERP 로그인도 멈춤(캐시 1분) — 감수.

### 4-2. 외래 키 448곳 → 「번호만 두고 확인은 코드」
| 대상 | 지금 | 바꾼 뒤 |
|---|---|---|
| accounts(143) | `uuid REFERENCES accounts` | `uuid` 칸만(외래 키 없음) · 넣을 때 `svc.accounts` 에 있는지 코드가 확인 · 이름은 조회 때 `svc.accounts` 조인 |
| hlt_product_options · hlt_products · hlt_sellers · advertisers | 외래 키 | 같은 방식 · 소개몰 상품 · 판매자는 `svc` 로 읽음 |
| files(3) · corp_docs(1) | 외래 키 | ERP 자기 파일 표 `erp_files` · 회사 문서는 ERP 로 옮김 |
| bzx_card_notices → acct_card_txns | 소개뱅크 → ERP | 외래 키 지우고 번호만 · 화면은 ERP API 로 읽음 |
| 함께 옮기는 qlt · lgl · its · prr · sal 17곳 | 소개뱅크 → ERP | ERP 안 외래 키 그대로 |

### 4-3. 소개뱅크 자료 읽기 (33표)
- **A안(추천)** postgres_fdw 읽기 전용 외부 표 — 코드 변경이 가장 적음(쿼리의 표 이름 앞에 `svc.`) · 읽기 전용 DB 사용자 `erp_ro`(SELECT 만). RDS 에서 확장 · 사용자 만들기는 사람이 함(**지원 · 권한 확인 필요**).
- B안(A가 안 되면) 소개뱅크 내부 API(`/internal/erp/*`)로 읽기 + 자주 쓰는 표(accounts · 상품 · 판매자)는 ERP 에 복사본(5분마다 바뀐 것만).
- 매출 · 정산 → 자동 전표(sources.ts 13가지)는 A안에서는 그대로 읽어 만듦 · 이미 만든 전표는 원본 번호(source_key)로 겹치지 않게 그대로.

### 4-4. ERP → 소개뱅크 쓰기
| 지금 ERP 코드가 쓰는 것 | 바꾼 뒤 |
|---|---|
| ops_alerts INSERT(82곳) | `POST /internal/erp/alerts`(서비스 토큰) — 운영 알림 · 텔레그램 · 게시판은 소개뱅크가 그대로 처리 |
| site_settings 읽기(66곳) | acct.* · hr.* · hra.* · ofc.* 설정은 ERP 자기 표 `erp_settings` 로 옮김 · 나머지(공휴일 · 회사 이름 등)는 `svc` 읽기 |
| 회원 알림(급여 명세 · 결재 요청 등) | `POST /internal/erp/notify` |
| 세금계산서 발행(etax 모듈 공유) | 발행 요청은 ERP · 실제 발행 길(ETAX 연동)은 소개뱅크에 두고 내부 API 로 — 연동 키 한 곳 |

### 4-5. 화면
- ERP 웹 = Vite + 지금 운영 화면 부품(디자인 시트 · sgb-tokens.css 그대로) · 화면 17개를 옮겨 메뉴 「회계 · 인사 · 사무 · 영업 · 구매 · 무역 · 품질 · 법무 · 자산」.
- 운영 화면의 옛 메뉴는 「ERP 로 이동했습니다 — 열기」 링크(정확한 위치는 옮길 때 adminMenu 로 표시).
- 나의 인사 카드(MyHrCard · 직원 본인용)는 ERP 의 「내 정보」로.

### 4-6. 정기 작업
- 23개(acct_* 18 · hr · hra · hrx · ofc 5)는 ERP 자기 작업 실행기로 옮김(같은 시각) · 소개뱅크 scheduler 에서는 지움(옮기는 판에서 · 같은 날 두 번 돌지 않게 스위치 `erp.jobs_owner = ERP`).

### 4-7. 새 기능 (분리 뒤 ERP 에서)
| # | 기능 | 내용 |
|---|---|---|
| 1 | 원가 배부 | 공통비(임차료 · 인건비 · 서버비)를 관(사업부) · 부서에 기준(매출 · 인원 · 직접 지정)으로 나눔 · 달마다 배부 전표 |
| 2 | 사업부(관)별 손익 | 관마다 매출(소개비 · 소개몰 · 광고 · 구독) − 직접비 − 배부비 · 달 · 분기 · 해 · CSV |
| 3 | 수출입 직접 신고 준비 | 지금 무역(수입 v10.411 · 수출 v10.428)은 관세사 신고 전제 → 신고 항목표 채우기 · 내보내기 · 실제 전송(유니패스)은 인증 · 신고 프로그램 등록 조건 **공식 확인 뒤** 2단계 |
| 4 | 영업 · 구매 · 결재 · 문서 다듬기 | 이미 있는 견적 · 주문 · 발주 · 결재선 · 회사 문서를 ERP 메뉴 흐름으로 정리 · 빠진 것은 옮긴 뒤 목록으로 |

## 5. 개발 · 점검 환경

| 항목 | 설계 | 대표 결정 |
|---|---|---|
| 저장소 | `sgb-erp` · main 직접 커밋 금지 · feature/ → PR → 병합(소개뱅크와 같음) · 백업 4곳에 더함 | 만들기 승인됨 |
| 점검판 | 소개뱅크 점검판에 ERP API · ERP 웹 컨테이너를 더함 · 같은 DB 컨테이너 안 `sgb_erp` | **새 포트 2개 필요**(예: 13100 API · 15175 웹) — CLAUDE.md 「점검판 포트」에 더할지 |
| realcheck | `~/sgb-check.sh` 가 ERP 도 띄우고 ERP 화면 · API 확인 줄을 더함 | — |
| 회귀 | ERP 시험은 sgb-erp/qa · 전체 점검은 둘 다 | — |
| 킷 | ERP 킷 따로(zip · tar) · 운영 절차서는 「소개뱅크 + ERP」 한 문서 | — |

## 6. 옮기는 순서 (운영 반영 「모두 개발하고 한 번에」에 맞춤)

| 단계 | 할 일 | 판 어림 |
|---|---|---|
| E1 | 저장소 · 뼈대(Nest · Vite · 로그인 확인 · 권한 · 작업 실행기 · 점검판) · 소개뱅크 `introspect` · `/internal/erp/*` API | ERP 3 ~ 5 · 소개뱅크 2 |
| E2 | `sgb_erp` DB · svc 외부 표 · 외래 키 바꾼 마이그레이션(표 169개 · 새 번호 E001 ~) · 자료 복사 도구(대조 숫자) | ERP 3 ~ 4 |
| E3 | 회계 · 세무 옮기기(전표 · 장부 · 결산 · 신고 · 매입 · 은행 · PG) | ERP 6 ~ 8 |
| E4 | 인사 · 사무 옮기기(hr · hra · hrx · ofc · 내 정보) | ERP 4 ~ 5 |
| E5 | 영업 · 구매 · 무역 · 품질 · 법무 · 자산 옮기기 | ERP 5 ~ 7 |
| E6 | 새 기능 — 원가 배부 · 사업부 손익 · 직접 신고 준비 | ERP 3 ~ 5 |
| E7 | 소개뱅크 정리 — 옛 화면 → 링크 · 정기 작업 넘김 스위치 · bzx 외래 키 · 옛 표 읽기 전용 표시(지우지 않음) | 소개뱅크 3 ~ 6 |
| E8 | 운영 절차서(소개뱅크 + ERP 한 번에) — RDS 스냅샷 → `sgb_erp` 만들기 · 확장 · 사용자(사람) → 자료 복사 → 대조 숫자 → 정기 작업 넘김 → 화면 확인 | 문서 |

**운영에서 사람이 해야 할 일(미리 알림)**: RDS 에 데이터베이스 `sgb_erp` · 확장 postgres_fdw · 읽기 전용 사용자 `erp_ro` 만들기 · `erp.sogaebank.com` DNS(가비아) · Nginx 허용 IP 블록 · ERP 서버 프로세스 시작(운영은 도커 없이 · 지금 서버 그대로면 pm2 는 사람이) · 비밀 값(서비스 토큰)은 운영 화면 또는 사람이 넣음.

## 7. 되돌리기

| 시점 | 방법 |
|---|---|
| E8 적용 중 실패 | RDS 스냅샷으로 되돌림 · 소개뱅크 옛 표 · 화면이 그대로라 전처럼 씀 |
| 적용 뒤 문제 | `erp.jobs_owner = SGB` 로 정기 작업을 소개뱅크로 되돌리고 옛 메뉴 다시 켬(옛 표는 지우지 않았음) · 그 사이 ERP 에 새로 쓴 자료는 대조표로 옮겨 적음(사람 확인) |
| 옛 표 지우기 | 적용 뒤 2 ~ 4주 문제없으면 **따로 승인** 받아 지움 |

## 8. 위험과 대비

| 위험 | 대비 |
|---|---|
| RDS 에서 postgres_fdw 를 못 씀 | 4-3 B안(내부 API + 복사본) — 판 3 ~ 5 더 듦 |
| 소개뱅크가 멈추면 ERP 로그인 멈춤 | 캐시 1분 · 운영 알림 · 감수(같은 서버라 함께 멈춤) |
| 같은 RDS 라 부하가 겹침 | 무거운 보고서는 밤 정기 작업 · 느린 조회 기록(이미 있음) 지켜봄 · 재설계 때 나눔 |
| 전표가 두 번 생김 | 원본 번호(source_key) 고유 그대로 · 정기 작업 넘김 스위치 하나 |
| 시험 · 점검 시간이 늘어남 | ERP 시험만 도는 줄인 점검 · 묶음 6 회귀 시간 줄이기(v10.785)와 함께 |
| 세무 규칙이 섞임 | 전표 규칙 · 계정표는 그대로 옮김(바꾸지 않음) · 바뀐 점 없음을 대조 시험으로 |

## 9. 대표 결정이 더 필요한 것

| # | 결정 | 추천 |
|---|---|---|
| 1 | 점검판 새 포트 2개(ERP API · ERP 웹) | 13100 · 15175 를 점검판 포트에 더함 |
| 2 | ERP 화면 주소 | `erp.sogaebank.com`(허용 IP) |
| 3 | 함께 옮길 백오피스 범위 | 품질 · 법무 · 자산 · 인사 평가 · 영업 기회까지(외래 키로 묶여 있음) |
| 4 | 옛 표 지우는 시점 | 적용 뒤 2 ~ 4주 · 따로 승인 |

## 10. 근거
- 코드 집계: sgb-core feature/v10.774(v10.783) — prisma/migrations 표 · 외래 키 · src/modules/acct 89파일 · src/worker/scheduler.service.ts · web/src/app/admin
- 결정: decisions/deploy-cicd.md #17(CI A안) · backoffice ERP 할 일(11/18 · 11/19 회계 · 세무 1단계) · 11/25 대표 답(ERP 분리 · 로그인 · DB · 저장소)
- 확인 필요: AWS RDS for PostgreSQL 확장 목록(postgres_fdw) · 관세청 유니패스 전자 신고 조건 · 비용
