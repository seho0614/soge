# 001. ERP API 뼈대 · sgb_erp 연결 · 마이그레이션 실행기 — e1.1 (2026-11-25)

## 1. 결론

- E1 두 번째 판. ERP API 가 뜨고 자기 데이터베이스(`sgb_erp`)에 붙어 건강 확인을 냅니다. 화면 · 로그인은 다음 판.

| 항목 | 내용 |
|---|---|
| API | `api/` — Node 22 · Nest 11(소개뱅크와 같은 판) · 포트 `PORT`(기본 3100 · 점검판 13100) · 입력 검사 규칙 같음 |
| `GET /api/v1/health` | 공개 — `status` · `service: sgb-erp` · `version` · `db` · `database` · `migrations` · `time`(비밀 · 설정 값 없음) |
| 마이그레이션 | `api/scripts/migrate.js` — 소개뱅크와 같은 규칙(체크섬 · 파일 하나 = 한 트랜잭션 · 바뀐 파일 거부) · 이름 `E001_…` · **소개뱅크 DB(sgb)에 붙으면 멈춤** |
| E001 | `erp_settings`(값 꼴 트리거 · 바꾼 사람은 소개뱅크 계정 번호 · 외래 키 없음) · `erp.jobs_owner = SGB`(정기 작업은 E7 에서 넘김) |
| 점검판 이미지 | `api/Dockerfile`(시작할 때 마이그레이션 → 개발 서버) — 점검판 연결은 e1.5 |

## 2. 다음

e1.2 로그인 확인(소개뱅크 introspect · 1분 캐시) · task 권한 · 감사 기록.
