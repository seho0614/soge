# 910. 의존 패키지 보안 점검 — 운영 화면 vite 8.2.6 · source-map-js 1.2.2 — v10.795 (2026-11-25)

## 1. 결론

- 대표 결정(11/25): 묶음 7 6번 「의존 패키지 보안(npm audit · Nest · Next · Vite)」.
- 11/25 `npm audit --package-lock-only`(잠금 파일만 · 설치 안 함 · 개발 도구 포함) 결과:

| 곳 | 결과(전) | 고친 뒤 |
|---|---|---|
| API(Nest) | 0건 | 0건 |
| 사용자 웹(Next) | 0건 | 0건 |
| 운영 화면(Vite) | **심각 2건** — vite 8.2.2(개발 서버 launch-editor · server.fs 우회 등 6개 공지 · 8.2.3 까지) · source-map-js 1.2.1(색인 오프셋 처리 지연) | **0건** |

- 둘 다 **개발 도구(devDependencies)**라 운영 서버가 내보내는 화면 파일(빌드 결과)에는 실리지 않습니다. 기존 정기 검사(`scripts/deps-audit.js` · v10.221)는 서비스 묶음만(--omit=dev) 보므로 잡히지 않았습니다. 개발 서버 · 빌드 도구의 위험이라 고칩니다.
- 판 고르기: 같은 8.2 줄의 고친 판 **vite 8.2.6**(2026-11-09 게시 · 2주 넘음) · source-map-js 는 **1.2.2**(2026-09-30)로 고정(`overrides` — 1.2.3 · 1.2.4 는 게시 2주 안).
- 함께 바뀐 묶음(vite 가 끌어옴): rolldown 1.2.7 → 1.2.19(11/11) · @oxc-project/types 0.156.0 · wasm 용 선택 묶음(@emnapi/* · @napi-rs/wasm-runtime · tslib — 리눅스 x64 에는 설치되지 않음). 모두 게시 2주 넘음.

## 2. 바뀐 것

- `web/package.json` — vite `^8.2.6` · `overrides.source-map-js = 1.2.2`
- `web/package-lock.json` — 위 판으로 다시 만듦(`npm install --package-lock-only --ignore-scripts`)
- 시험 qa test_v1795(잠금 파일 판 · overrides). 빌드 확인은 realcheck(운영 화면 이미지 빌드)에서.

## 3. 앞으로

- 정기 검사는 지금처럼 `node scripts/deps-audit.js`(서비스 묶음) — 개발 도구까지 보려면 잠금 파일마다 `npm audit --package-lock-only`(이 문서 1절 방식).
- 운영 적용: 운영 화면 빌드 결과만 바뀜(마이그레이션 없음).
