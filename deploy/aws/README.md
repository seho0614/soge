# deploy/aws — AWS 서버에 올리는 스크립트 (v10.16)

절차와 확인 내용은 **`docs/60_로컬점검_AWS적용절차_v10.16_20261003.md`** 에 있습니다. 여기는 파일 설명만 둡니다.

| 파일 | 하는 일 | 바꾸는 것 |
|---|---|---|
| `precheck.sh` | 적용 전 — 서버의 지금 상태(프로그램 · 메모리 · pm2 · .env 키 · DB · 마이그레이션 · Nginx) | 없음(읽기만) |
| `apply.sh` | 새 판 올리기 — 설치 · 빌드 → 마이그레이션(스냅샷 확인 뒤) → 배포 점검 → 교체 → 기동 확인 → 적용 후 확인 | DB 구조 · `~/sgb` · pm2 |
| `postcheck.sh` | 적용 후 확인 — 프로세스 · API · DB · 사용자 웹 · 운영 화면 · 배치 · 파일 저장 · Nginx · 열기 전 상태 | 없음(읽기만) |
| `rollback.sh` | 전 판으로(코드만 — DB 는 그대로) | `~/sgb` · pm2 |
| `run-api.sh` · `run-site.sh` · `run-jobs.sh` | pm2 가 부르는 실행 스크립트 (`sgb` · `sgb-site` · `sgb-jobs`). `.env` 를 직접 읽습니다 | — |
| `nginx-sgb.conf.example` · `nginx-render.sh` | Nginx 설정 예시와, 주소 · 사무실 IP 를 채워 찍어 주는 도우미 | 없음(화면에 찍기만) |
| `psql.sh` | `.env` 의 접속 주소로 운영 DB 에 psql | — |
| `seed-test-users.sql` | v10.36 — 시험 계정 6개(@t.local · 비밀번호는 실행 때 `-v pw=…`). 다시 돌리면 비밀번호를 바꾸고 정지를 풉니다. **오픈 직전 정지**(파일 머리말) | 운영 DB(accounts · account_roles) |
| `env.production.example` | 운영 `.env` 에 들어가는 값의 이름과 뜻 | — |
| `lib.sh` | 공용 함수 | — |
| `cloudwatch/setup.sh` | v10.88 — CloudWatch 경보 12개 · 메일(SNS `sgb-alerts`) · 로그 그룹 4개 · 오류 줄 필터. **AWS CloudShell 에서** check · apply · test(docs/142) | AWS 계정(CloudWatch · SNS · Logs) |
| `cloudwatch/agent.json` | v10.88 — CloudWatch 에이전트 설정(메모리 · 디스크 · pm2 로그 · Nginx 오류 로그). 서버에서 `amazon-cloudwatch-agent-ctl -a fetch-config … -c file:…/agent.json` | 없음(설정 파일) |

서버의 폴더

```
~/sgb                      → ~/sgb-releases/<판>_<시각>   (바로가기 — 이것만 바꾸면 판이 바뀝니다)
~/sgb-releases/            판 보관 (전 판 포함 — 최근 2개만 남기고 지워도 됩니다)
~/sgb-data/uploads/        올린 파일 (S3 를 안 쓸 때) — 판과 무관
~/sgb-data/logs/           precheck · apply · postcheck 기록
```

이 스크립트들은 **킷 작업 환경에서 「9/30 에 세운 서버」를 흉내 내어 처음부터 끝까지 돌려 본 것**입니다(`qa/aws_rehearsal.sh` — Ubuntu 24.04 · Node 22 · PostgreSQL 16 · nginx 1.24 · pm2).
실제 AWS(EC2 · RDS · 인증서 · S3)에서는 돌려 보지 못했습니다 — 달라질 수 있는 곳은 절차서 9부에 적었습니다.
