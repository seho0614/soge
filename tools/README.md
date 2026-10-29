# tools — 개발 서버(sgbdev) 스크립트

| 파일 | 하는 일 | 문서 |
|---|---|---|
| `backup-full.sh` | 전체 백업 3개(저장소 묶음 · 작업 폴더 · Claude 작업) → `~/backup` · 최근 2벌만 남김 · 결과 `~/backup/last.txt` | sgb-core docs/222 · docs/224 |
| `backup-github.sh` | CodeCommit 4개 → GitHub `seho0614/soge`(갈래 앞머리 `<저장소>/`) · 결과 `~/backup/github-last.txt` | sgb-core docs/223 0절 |
| `home/` | 홈 스크립트 사본(`sgb-check.sh` · `make-kit.sh` · `import-kit.sh` · `start-claude.sh` · `step17.sh`) — 실제로 도는 것은 `~/` 의 것 · 바꾸면 여기에도 맞춤 | sgb-core docs/222 6-3 |

예약 작업은 `~/bin/` 사본을 부른다(갈래를 바꿔도 예약이 깨지지 않게). 등록 명령은 sgb-core docs/222 4절.
