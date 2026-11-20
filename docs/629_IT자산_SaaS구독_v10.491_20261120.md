# 629. IT 자산 · SaaS 구독 (v10.491 · 2026-11-20)

## 1. 결론
회사가 쓰는 프로그램 · 구독 · 라이선스 · 도메인 · 클라우드 · 기기를 한 표로 관리합니다 — **라이선스 수 · 쓰는 수 · 담당 · 결제 주기 · 금액 · 다음 갱신일 · 자동 갱신**. 달 비용은 **회계 › 자금 흐름 예정(나감)** 에 저절로 이어지고, 갱신일 30 · 7일 전에 운영 알림(ITS_ASSET_RENEW)이 갑니다. 위치: **사무 › IT 자산 · 구독** · SB-ADM-ITS-020 · ADMIN · PAYOUT · SUPER.

| 결제 주기 | 달 비용 | 자금 흐름 예정 |
|---|---|---|
| 매달 | 금액 | 매달 반복(갱신일의 날짜) |
| 매년 | 금액 ÷ 12 | 갱신일에 한 번(금액 전부) |
| 한 번 | 0 | 갱신(지급)일이 오늘 뒤면 한 번 |
| 무료 | 0 | 없음(금액 0 만) |

## 2. API
| 방법 | 주소 | 설명 |
|---|---|---|
| GET | /admin/its/assets?state=ACTIVE\|CANCELED\|ALL | 목록 · 달 비용 합 · 1년 · 남는 라이선스 · 30일 안 갱신 · 담당 고를 사람 |
| POST | /admin/its/assets | 넣기(종류 · 이름 · 금액 · 갱신일 · 「자금 계획에 넣기」 처음 켬) |
| PUT | /admin/its/assets/{id} | 보낸 칸만 · 종류는 못 바꿈 · 금액 · 주기 · 갱신일이 바뀌면 옛 예정 취소 + 새 예정 |
| POST | /admin/its/assets/{id}/cancel | 해지(사유) · 이은 예정 취소 |

오류: 404 · 409 ITS_ASSET_STATE(해지한 것) · DUPLICATE(같은 자산 번호) · 422 ITS_ASSET_KIND · NAME · TAG · SEATS · CYCLE · COST · DATE · MEMO · OWNER · REASON.

## 3. 표 · 설정 · 정기 작업 (D270)
- its_assets — kind SAAS · LICENSE · CLOUD · DOMAIN · DEVICE · OTHER · seats · seats_used · owner_id · billing_cycle · cost_amount(원 · 부가세 포함 · 외화는 원으로 바꿔 적음) · renew_on · auto_renew · cash_plan · cash_plan_id → acct_cash_plans · state ACTIVE · CANCELED.
  트리거 trg_its_asset_guard — 지우기 막음 · 종류 · 넣은 사람 고정 · 해지한 것 고치기 막음. 자산 번호 정규식 = 서버 ASSET_TAG_RE.
- ⑬ 자금 흐름(D245 acct_cash_plans)은 내용을 고치지 않는 표라서, 바뀌면 **옛 예정을 취소(사유 「IT 자산 바뀜」)하고 새로 넣습니다** — cashflow.ts 는 고치지 않음.
- 설정 its.asset_alert(on) · its.asset_alert_days(30,7) · 정기 작업 its_office_daily 매일 08:55 — ① 자동 갱신 자산의 지난 갱신일을 다음 주기로 옮기고 예정을 맞춤 ② 갱신 N일 전 · 지남 ITS_ASSET_RENEW(자산 · 갱신일 · 단계마다 한 번).

## 4. 주의
1. 외화 결제 SaaS 는 원으로 바꿔 적습니다(환율이 바뀌면 금액을 고치면 예정이 새로 들어감).
2. 전표는 만들지 않습니다 — 실제 결제는 지금처럼 법인카드 · 경비 · 고정비(v10.439)로 들어갑니다. 이 표는 관리 · 예정용입니다.
3. 자금 계획 묶음(㊱ 등)이 다른 예정 표를 쓰게 되면 이음만 옮깁니다(NOTES).

## 5. 시험 (test_v1491)
① 코드 ② 매달 예정 · 검수 담당 403 · 금액 바꾸면 예정 다시 · 메모만이면 그대로 · 매년 한 번 예정 · 달 비용 ÷ 12 · 무료 금액 422 · 갱신일 없음 422 · 자산 번호 400 · 자동 갱신일 옮김 · 갱신 알림 7 · 30일 칸 · 해지 → 예정 취소 · 409 · DB 지우기 막음 ③ 화면
