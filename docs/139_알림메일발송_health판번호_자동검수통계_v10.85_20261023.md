# 139. 알림 메일 실제 발송 · /health 판 번호 · 자동검수 운영 확인 SQL (v10.85 · 2026-10-23)

> 대표 결정(2026-10-23 「F g e」 · 「승인」 — G 는 기본값: 로그인 없이 보는 /health 에 판 번호 하나만)
> 앞 판: docs/138(v10.84) · **마이그레이션 없음**(150 그대로)

## 1. 결론

| # | 전 | 후 |
|---|---|---|
| F | 알림(거래 · 신고 결과 · 계약 독촉 …)의 메일은 `notify_dispatch` 가 **대기(QUEUED)로만** 남기고 보내지 않음(mail-ses #8) | 같은 배치가 대기 메일을 **실제로 보냄**(v10.43 발송기 · SES SMTP) — 성공 SENT · 거절 FAILED · 연결 · 시간 초과는 3번까지 다시 · 회원이 끈 알림 · 쓰지 않는 계정 · 3일 넘은 알림은 보내지 않고 닫음 |
| G | `/api/v1/health` 에 판 번호 없음 — 운영 판은 서버에서 `cat ~/sgb/VERSION` 으로만 | 응답에 `version`(예: v10.85) 하나 — 켜질 때 VERSION 파일을 한 번 읽음 |
| E | 운영 적용 뒤 자동검수를 볼 방법이 정해져 있지 않음 | `deploy/aws/review-stats.sql`(**읽기 전용 거래** · 끝에 되돌림) — 관별 자동화율 · 사람 검수 이유 · 결과 · 표본 감사 · 금칙어 사전 · 노출 중인데 차단 금칙어가 든 매물(번호만) |

### F — 보내는 조건 (새 스위치 없음)

MailService.ready() 그대로: `SMTP_HOST · SMTP_USER · SMTP_PASS` + 보내는 주소(`notify.mail_from` · 없으면 `MAIL_FROM`) + 운영 스위치 **`notify.email_verified = on`**.
하나라도 없으면 아무것도 보내지 않고 대기 그대로 둡니다 — SES 설정(docs/92 · mail-ses) 뒤 스위치를 켜면 그때부터 보냅니다.

| 결과 | 기록(notification_deliveries) |
|---|---|
| 성공 | `SENT` · 보낸 시각 · provider `SES` · 메시지 번호 |
| 받는 주소 거절 · 인증 실패 · 형식 | `FAILED` · 까닭 |
| 연결 끊김 · 시간 초과 | `QUEUED` 그대로 · 까닭 칸 `RETRY n` → 세 번째 실패에 `FAILED` |
| 회원이 그 알림 메일을 끔(정책이 끄기를 허락할 때) | `FAILED` · `OPTED_OUT` (보내지 않음) — 정책이 허락하지 않는 알림은 꺼도 보냄 |
| 쓰지 않는 계정 · 3일 넘은 알림 · 받는 주소 없음 | `FAILED` · `ACCOUNT_INACTIVE` · `EXPIRED` · `NO_EMAIL` |

메일 내용: 제목 = 알림 제목(줄바꿈은 빈칸) · 본문 = 알림 내용 + 「바로 가기」(사이트 안 주소만 · `site.base_url` 앞에) + 「알림 보기 · 설정」 안내. 받는 주소는 기록에 남기지 않습니다.

### E — 운영 서버에서

```bash
bash ~/sgb/deploy/aws/psql.sh -v days=14 -f ~/sgb/deploy/aws/review-stats.sql > ~/review-stats.txt
```

운영 적용(v10.85) 뒤 며칠(등록이 쌓인 뒤) 돌려 `~/review-stats.txt` 를 보내 주시면 분석 · 정리 방안을 드립니다.

## 2. 바뀐 파일

| 파일 | 내용 |
|---|---|
| `src/common/mail/notify-mail.ts` | 새 파일 — NotifyMailSender · notifyMailText |
| `src/worker/scheduler.service.ts` | notify_dispatch 끝에 대기 메일 보내기 · MailService 주입 |
| `src/modules/public/health.controller.ts` | 응답에 version |
| `deploy/aws/review-stats.sql` | 새 파일 — 읽기 전용 통계 |
| `scripts/test-notify-mail.ts` · `scripts/verify-all.sh` | 알림 메일 발송 시험(진짜 DB · 거래 안 · 되돌림) — 통합 검정에 |
| `VERSION` | v10.85 |

sgb-infra: `qa/test_v1085.py`.

## 3. 운영 적용

마이그레이션 없음. 운영이 v10.65 이면 v10.66 ~ v10.85 를 한 번에 — `올릴 것 7(D106 ~ D112) · 150 / 150`(v10.84 와 같음). 절차서 docs/134 를 이 판 킷으로 고칩니다.
