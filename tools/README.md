# tools — 개발 서버(sgbdev) 스크립트

| 파일 | 하는 일 | 문서 |
|---|---|---|
| `backup-full.sh` | 전체 백업 3개(저장소 묶음 · 작업 폴더 · Claude 작업) → `~/backup` · 최근 2벌만 남김 · 결과 `~/backup/last.txt` | sgb-core docs/222 · docs/224 |
| `backup-github.sh` | CodeCommit 4개 → GitHub `seho0614/soge`(갈래 앞머리 `<저장소>/`) · 결과 `~/backup/github-last.txt` | sgb-core docs/223 0절 |
| `ops-doc-draft.py` | 운영 절차서 초안 — 킷 두 개(지금 운영 · 올릴 판 · `~/kits/release/`)를 읽기만 해서 docs/409 모양 초안 .md · sha256 · 마이그레이션 · precheck 기대 줄 · 판 문서 「바뀐 것」 · 사람이 채울 곳 〔채울 것〕 · sha 스스로 대조 · v10.299: 지우는 문장 검사 · 마이그레이션 NOTICE 표 · 새 정기 작업 · 회귀 수 · `--rehearsal 결과.txt` 로 postcheck [11] · 리허설 줄 · v10.306: `--postcheck-base 54/0/5`(지난 운영 postcheck) 로 「postcheck 기대」 숫자 · 달라지는 줄 | sgb-core docs/417 · 419 · 428 |
| `mig-rehearsal.sh` | 마이그레이션 리허설 — `bash tools/mig-rehearsal.sh <지금 운영 킷.zip> <올릴 킷.zip> -o 결과.txt` · 버리는 postgres:16(포트 안 엶 · 끝나면 지움)에 옛 마이그레이션 + 시드 → 숫자 13개 → 새 마이그레이션(migrate.js) → 한 번 더(적용 0) → SQL 하나씩 다시(재실행 안전) → 숫자 비교 · v10.306: 새 킷 postcheck 의 DB 방식(`POSTCHECK_DB_ONLY`)으로 적용 전 · 뒤 「확인」 · 「실패」 줄 차이(`pc_*`) · 종료 0 통과 · 1 실패 · 2 쓰는 법 | sgb-core docs/419 · 428 |
| `reh-check.sh` | 점검에 넣은 리허설 — `~/sgb-check.sh` 가 realcheck 때 킷을 만든 뒤 부름 · `~/kits/ops/`(지금 운영 킷 · 판 번호 큰 것 · 오래된 킷 정리에서 빠짐) → 새 킷으로 `mig-rehearsal.sh` · summary.txt 끝에 「리허설(운영 킷 → 새 킷): …」 한 줄 · 실패면 realcheck 도 실패 · 운영 킷이 없으면 「건너뜀」 · `SGB_NO_REH=1` 이면 안 돎 · **운영 적용이 끝나면 그 킷을 `~/kits/ops/` 에 넣고 옛 킷을 뺌** | sgb-core docs/424 |
| `home/` | 홈 스크립트 사본(`sgb-check.sh` · `make-kit.sh` · `import-kit.sh` · `start-claude.sh` · `step17.sh`) — 실제로 도는 것은 `~/` 의 것 · 바꾸면 여기에도 맞춤 | sgb-core docs/222 6-3 |

예약 작업은 `~/bin/` 사본을 부른다(갈래를 바꿔도 예약이 깨지지 않게). 등록 명령은 sgb-core docs/222 4절.
