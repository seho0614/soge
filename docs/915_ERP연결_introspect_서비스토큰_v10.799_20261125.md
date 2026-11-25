# 915. ERP 연결 ① — 운영자 토큰 확인(introspect) · ERP 서비스 토큰 — v10.799 (2026-11-25)

## 1. 결론

- 대표 11/25 ERP 분리 · **E1 계획 승인**(로그인은 짧은 교환 코드 · ERP 는 비밀 키를 갖지 않음) — 소개뱅크 쪽 첫 판.
- ERP 서버가 화면이 낸 **운영자 토큰을 그대로 소개뱅크에 물어** 「누구 · 운영자인지 · 2단계 확인 · 업무 권한」을 받습니다(ERP 가 1분 기억 · e1.2).

| 길 | 누가 | 내용 |
|---|---|---|
| `GET /api/v1/auth/introspect` | ERP 서버(머리 `X-Erp-Service-Token` + 운영자 `Authorization: Bearer`) | `active` · `accountId` · `name` · `roles` · `staff` · `super` · `mfaOk`(2단계 · 패스키 확인 마침) · `perm{enforce, decide, tasks}` · `exp` — 운영자가 아니면 `active=false`(200) |
| `GET /api/v1/admin/erp/link` | ADMIN · SUPER | 서비스 토큰 있음 / 없음 · 바꾼 시각(값은 안 보임) |
| `POST /api/v1/admin/erp/service-token` | SUPER | 새 토큰(원문은 응답에 한 번만 · DB 에는 sha256) · 전 토큰 바로 무효 · 감사 `ERP_SERVICE_TOKEN_ROTATE` |

- 위치: 운영 화면 › 외부 연동 › 연동 키 아래 **「ERP 연동」** 상자(「토큰 만들기」 — SUPER).
- 서비스 토큰이 비어 있으면 introspect 는 **닫힘**(403 `ERP_TOKEN_UNSET` · InternalKeyGuard 와 같은 원칙).
- 토큰 검사 · 계정 다시 읽기 · 2단계 · 패스키 판정은 기존 `AuthMiddleware` 결과(`req.principal`)를 그대로 씀 — 판정이 두 곳에 생기지 않음.
- 운영 화면 접속 인증(허용 IP)은 ERP 서버 주소로 판정되므로 보내지 않습니다 — ERP 화면은 Nginx 허용 IP 로 막습니다(설계서 4-1).

## 2. 바뀐 것

| 항목 | 내용 |
|---|---|
| 마이그레이션 D333 | 설정 `erp.service_token_hash`(NULL = 닫힘 · sha256 꼴) · 표 `erp_handoff_codes`(v10.800 이 씀 · 60초 · 한 번 · 해시만) · 주소 표 2줄(업무 integrations) |
| 서버 | `src/modules/erp-link/` — `erp-link.guard.ts`(같은 길이 비교 · timingSafeEqual) · `erp-link.ts` · `erp-link.controller.ts` |
| 화면 | `ErpLinkBox.tsx`(Integrations 에 끼움) |
| 명세 | 새 화면 `SB-ADM-ERP-010 ERP 연동 (내부)` · SIT-080 에 API 2 |
| 시험 | qa test_v1799 |

## 3. 운영 적용

- 마이그레이션 1개(설정 1줄 · 표 1개 · 기존 자료 안 바꿈). ERP 를 운영에 올리는 날(E8) SUPER 가 「토큰 만들기」 → ERP 서버 .env `SGB_SERVICE_TOKEN`.
