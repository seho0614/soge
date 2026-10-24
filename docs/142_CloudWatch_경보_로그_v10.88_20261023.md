# 142. CloudWatch 경보 · 로그 (v10.88 · 2026-10-23)

> 대표 결정(2026-10-23 「Cloud watch 구축」 → 받는 메일 지정 · 범위는 추천안 1 · 2단계 · 기준값은 기본값)
> 앞 판: docs/141(v10.87) · **마이그레이션 없음** · 앱 코드 바뀌지 않음(`deploy/aws/cloudwatch/` 두 파일만 더함)

## 1. 결론

| 단계 | 하는 일 | 어디서 · 누가 | 언제 |
|---|---|---|---|
| 1 | 경보 12개 · 메일 받기(SNS) · 로그 그룹 4개 · 오류 줄 세기 | **AWS CloudShell** 에서 사람이 `setup.sh` | 아무 때나(운영 적용과 무관) |
| 2 | 서버 안쪽(메모리 · 디스크) 값과 pm2 · Nginx 로그를 CloudWatch 로 보내는 **에이전트** | 운영 서버에서 사람이(ubuntu · sudo) | **v10.88 운영 적용 뒤**(`~/sgb/deploy/aws/cloudwatch/agent.json` 이 생긴 뒤) |
| 3 | 밖에서 `/api/v1/health` 를 확인(Route 53 상태 확인) | — | 도메인 공개 뒤 · 이번에 하지 않음 |

경보를 받는 곳: SNS 주제 `sgb-alerts` → 메일(대표 지정 주소). 울릴 때(ALARM)와 풀릴 때(OK) 모두 보냅니다.

## 2. 경보 13개(v10.90 · 처음 12개) (기본값 — 환경 값으로 바꿀 수 있음)

| 이름 | 무엇 | 기준 | 값이 오는 곳 |
|---|---|---|---|
| sgb-ec2-cpu | 서버 CPU | 80% 이상 5분 | AWS 기본 |
| sgb-ec2-status | 서버 상태 점검 실패 | 2분 연속 | AWS 기본 |
| sgb-ec2-mem | 서버 메모리 사용률 | 90% 이상 5분 | 에이전트(2단계) |
| sgb-ec2-disk | 서버 디스크(/) 사용률 | 85% 이상 | 에이전트(2단계) |
| sgb-rds-cpu | DB CPU | 80% 이상 5분 | AWS 기본 |
| sgb-rds-conn | DB 연결 수 | max_connections 의 80% 이상 | AWS 기본 |
| sgb-rds-storage | DB 남은 저장 공간 | 할당량의 15% 이하 | AWS 기본 |
| sgb-rds-mem | DB 남은 메모리 | **64MB** 이하 10분(v10.90 부터 기본값 · 처음 200MB 는 항상 울려 2026-10-24 바꿈 · 7절) | AWS 기본 |
| sgb-log-api | API(Nest) 오류 줄 `ERROR` | 5분에 10건 이상 | 에이전트 → 지표 필터 |
| sgb-log-site | 사용자 웹(Next) `ERROR` · `Error:` · `⨯` | 5분에 10건 이상 | 〃 |
| sgb-log-jobs | 배치 `tick 실패` · `JOB_TOKEN` | 5분에 10건 이상 | 〃 |
| sgb-log-nginx | Nginx `[error]` 이상 | 5분에 10건 이상 | 〃 |
| sgb-review-sla | **검수 기한 넘김**(배치 sla_alert 의 `REVIEW_SLA_BREACH` 줄 · v10.90) | 2시간에 1건 이상 | 에이전트 → 지표 필터(/sgb/api) |

- 값이 없을 때(에이전트 설치 전 등)는 「정상」으로 봅니다(notBreaching) — 1단계만 해 두어도 거짓 경보가 나지 않습니다.
- **주의** — 이 서버에는 개발용 점검판(도커)도 돕니다. 점검판을 돌릴 때 CPU · 메모리 경보가 울릴 수 있습니다(운영 전환 때 서버를 나누면 사라짐).
- 로그 이름: v10.86 부터 정기결제 배치는 `RecurringBatchService`, 리드 이용료 경고는 `PartnerLeadService` 입니다(docs/140). 위 필터는 이름이 아니라 `ERROR` 낱말을 셉니다.

## 3. 비용 (변할 수 있음 — 실행 전 확인 필요)

경보 12개 · 사용자 지표 약 6개(메모리 · 디스크 · 오류 4) · 로그 수집 소량(하루 수십 MB 예상) → **월 수 달러 이하로 예상**합니다.
CloudWatch 무료 사용량(경보 · 지표 · 로그 일부)이 있지만 계정마다 다릅니다. 실행 전에 AWS 요금 안내(CloudWatch · 서울 리전)를 확인하십시오 — **추가 확인이 필요합니다.**

## 4. 1단계 — 경보 만들기 (AWS CloudShell)

한 블록씩 하고, 결과를 Claude 에게 보낸 뒤 다음 블록으로 갑니다.

### 4-1. 파일을 PC 로 받기 (PC · PowerShell)

```powershell
scp sgb-dev:~/sogaebank/sgb-core/deploy/aws/cloudwatch/setup.sh C:\sgb\
```

### 4-2. DB 의 max_connections 확인 (운영 서버 · ubuntu)

```bash
bash ~/sgb/deploy/aws/psql.sh -At -c "SHOW max_connections"
```

나온 숫자를 적어 둡니다(예: 81 · 189 — DB 크기에 따라 다름).

### 4-3. CloudShell 에서 check (읽기만)

1. AWS 콘솔 오른쪽 위 리전이 **서울(ap-northeast-2)** 인지 확인
2. 위쪽 막대의 CloudShell 아이콘(>_) → 열리면 **작업 › 파일 업로드** → `C:\sgb\setup.sh`
3. 아래를 붙여 넣기(숫자는 4-2 값)

```bash
ALERT_EMAIL=sh0614park94@gmail.com RDS_MAX_CONNECTIONS=숫자 bash setup.sh check
```

맞으면: `ok EC2 i-… (3.37.95.217)` · `ok RDS …` · 「할일」 줄들(주제 · 구독 · 로그 그룹 4 · 필터 4 · 경보 12) · `check 끝 — 지금 있는 sgb-* 경보 0개`.
EC2 · RDS 를 찾지 못하면 멈춥니다 — 화면을 그대로 보내 주십시오.

### 4-4. apply (만들기)

```bash
ALERT_EMAIL=sh0614park94@gmail.com RDS_MAX_CONNECTIONS=숫자 bash setup.sh apply
```

같은 목록이 한 번 더 나온 뒤 「만들까요?」 → 소문자 `yes`. 끝 줄 `apply 끝 — sgb-* 경보 12개`.

- [ ] 메일함에 「AWS Notification - Subscription Confirmation」 → **Confirm subscription** 누름(스팸함도 확인)

### 4-5. 시험 메일

```bash
bash setup.sh test
```

- [ ] 1 ~ 2분 안에 「ALARM: "sgb-ec2-cpu"」 메일
- [ ] 5 ~ 10분 뒤 「OK: "sgb-ec2-cpu"」 메일

## 5. 2단계 — 에이전트 (운영 서버 · v10.88 적용 뒤)

### 5-1. 서버에 권한 붙이기 (AWS 콘솔)

IAM → 역할 → **sgb-ec2-role**(서버에 붙은 역할 · 인스턴스 프로필 같은 이름 — AWS 구축 절차서 10-4 의 `sgb-ec2-s3` 는 실제에 없음 · 2026-10-24 확인) → 권한 추가 → 정책 연결 → **CloudWatchAgentServerPolicy** 체크 → 권한 추가.
(CloudShell: `aws iam attach-role-policy --role-name sgb-ec2-role --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy`)

- [ ] 역할의 권한 목록에 CloudWatchAgentServerPolicy 가 보임

### 5-2. pm2 로그 파일 이름 확인 (운영 서버 · ubuntu)

```bash
ls ~/.pm2/logs/
```

맞으면: `sgb-out.log · sgb-error.log · sgb-site-out.log · sgb-site-error.log · sgb-jobs-out.log · sgb-jobs-error.log`(뒤에 `-0` 이 붙어 있으면 멈추고 보내 주십시오 — agent.json 을 맞춰야 함).

### 5-3. 에이전트 설치 · 시작 (운영 서버 · ubuntu)

```bash
cd /tmp
wget -q https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i -E ./amazon-cloudwatch-agent.deb
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s \
  -c file:/home/ubuntu/sgb/deploy/aws/cloudwatch/agent.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status
```

맞으면 마지막 명령에 `"status": "running"`.

### 5-4. 들어오는지 확인 (5분 뒤 · AWS 콘솔)

- [ ] CloudWatch → 로그 그룹 → `/sgb/api` 안에 `i-…-out` · `i-…-error` 스트림
- [ ] CloudWatch → 지표 → CWAgent → InstanceId → `mem_used_percent` · `disk_used_percent`
- [ ] CloudWatch → 경보 → `sgb-ec2-mem` · `sgb-ec2-disk` 가 「데이터 부족」이 아니라 「정상」

### 5-5. 되돌리기 (필요할 때)

```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a stop     # 에이전트만 멈춤
```

경보 · 주제는 CloudWatch 콘솔에서 `sgb-` 로 골라 지울 수 있습니다(지워도 서비스에는 영향 없음).

## 6. 파일

| 파일 | 내용 |
|---|---|
| `deploy/aws/cloudwatch/setup.sh` | check · apply · test — CloudShell 용(서버에 경보 만드는 권한을 주지 않으려고) · 여러 번 돌려도 같은 결과 · 지우는 것 없음 |
| `deploy/aws/cloudwatch/agent.json` | 에이전트 설정 — 메모리 · 디스크(/) 1분마다 · pm2 로그 6개 · Nginx 오류 로그 → 로그 그룹 4개(보관 30일) · root 로 돎(ubuntu 의 pm2 로그를 읽으려고) |

## 7. 확인 (개발 서버)

- `bash -n` 문법 · agent.json 형식 · `qa/test_v1088.py`(경보 12개 이름 · 로그 파일 6개가 pm2 이름 sgb · sgb-site · sgb-jobs 와 맞음 · 지우는 명령 없음 · apply 가 묻기 전에 바꾸지 않음)
- 가짜 aws 명령으로 check · apply(no · yes) · test 를 돌림 — no 면 바꾼 것 0 · yes 면 주제 1 · 구독 1 · 필터 4 · 경보 12
- **실제 AWS 에 만드는 시험은 하지 않았습니다** — 4-3 check 결과로 처음 확인합니다.

## 7. 실제 구축 결과 (2026-10-24)

| 단계 | 결과 |
|---|---|
| 4-2 | DB max_connections **81**(db.t3.micro · 메모리 1GB) → 연결 경보 64개 이상 |
| 4-3 check | EC2 `i-055ee32624ab1a113` · RDS sgb-db(20GB) · 할일 24줄 · 기존 경보 0 |
| 4-4 apply | 경보 12 · 주제 `sgb-alerts` · 로그 그룹 4 · 필터 4 — 구독 확인은 메일이 늦어 `aws sns subscribe` 로 다시 보낸 뒤 확인됨 |
| 4-5 test | 구독 확인 뒤 ALARM · OK 메일 모두 받음 |
| 5-1 | 역할 **sgb-ec2-role** 에 CloudWatchAgentServerPolicy(원래 AmazonSSMManagedInstanceCore 만 · S3 정책 없음) |
| 5-2 | pm2 로그 6개 이름이 agent.json 과 같음(`-0` 없음) |
| 5-3 | x86_64 · 에이전트 1.300074.0b1920 · 설정 검사 통과 · `running` · `configured` · systemd 자동 기동 |
| 5-4 | `/sgb/api` 에 `i-…-out` 스트림(`-error` 는 새 오류 줄이 써질 때 생김) · CWAgent `mem_used_percent` · `disk_used_percent` 들어옴 |
| **rds-mem** | 200MB 기준으로 **항상 ALARM** — 지난 24시간 남은 메모리 최소 98MB · 평균 107 ~ 146MB(6시간 주기로 오르내림 · 줄어드는 추세 없음) → **`RDS_FREE_MEM_MB=64` 로 apply 다시**(대표 승인). **다시 돌릴 때도 `RDS_FREE_MEM_MB=64` 를 꼭 붙일 것**(빼면 기본값 200 으로 돌아가 다시 울림) — **v10.90 에서 기본값을 64 로 바꿈**(docs/145) |

주의 — 계정 8명 · 이용 거의 없음에서 이미 100MB 안팎이라, 오픈 뒤 64MB 경보가 잦으면 DB 를 db.t3.small(2GB)로 올릴지 검토(비용 — 요금표 확인 필요 · 운영 전환 서버 재설계 때 함께).
