#!/usr/bin/env bash
# =====================================================================
# CloudWatch 경보 만들기 (v10.88 · 2026-10-23 · docs/142) — 사람이 **AWS CloudShell** 에서 실행합니다.
#
#   ALERT_EMAIL=받을주소 RDS_MAX_CONNECTIONS=숫자 bash setup.sh            # check — 읽기만(만들 것을 보여 줌)
#   ALERT_EMAIL=받을주소 RDS_MAX_CONNECTIONS=숫자 bash setup.sh apply      # 만들기 — 「만들까요?」에 소문자 yes
#   bash setup.sh test                                                     # 시험 메일 1통(sgb-ec2-cpu 를 잠깐 ALARM 으로)
#
#   만드는 것(여러 번 돌려도 같은 결과 — 같은 이름은 덮어씀 · 지우는 것 없음):
#     · SNS 주제 sgb-alerts + 메일 구독(처음 한 번 — 받은 메일의 「Confirm subscription」을 눌러야 받기 시작)
#     · 경보 12개(이름 sgb-*) — 울릴 때와 풀릴 때 모두 메일
#         EC2   CPU ≥ 80%(5분) · 상태 점검 실패(2분) · 메모리 ≥ 90%(5분) · 디스크 ≥ 85%(5분)   ← 메모리 · 디스크는 에이전트(agent.json)가 있어야 값이 옴
#         RDS   CPU ≥ 80%(5분) · 연결 수 ≥ max_connections 의 80% · 남은 저장 공간 ≤ 15% · 남은 메모리 ≤ 200MB(10분)
#         로그  API · 사용자 웹 · 배치 · Nginx 오류 줄이 5분에 10건 이상
#     · 로그 그룹 4개(/sgb/api · /sgb/site · /sgb/jobs · /sgb/nginx-error · 보관 30일)와 오류 줄을 세는 지표 필터 4개(이름공간 SGB)
#
#   값(환경 값으로 바꿀 수 있음)
#     ALERT_EMAIL           경보를 받을 메일(apply 에 필요)
#     RDS_MAX_CONNECTIONS   운영 DB 의 max_connections — 서버에서 `bash ~/sgb/deploy/aws/psql.sh -c 'SHOW max_connections'`
#     REGION(ap-northeast-2) · EIP(3.37.95.217 — 이 주소의 EC2 를 찾음) · INSTANCE_ID · RDS_ID(DB 가 하나면 자동)
#     CPU_PCT(80) · MEM_PCT(90) · DISK_PCT(85) · STORAGE_FREE_PCT(15) · RDS_FREE_MEM_MB(200) · LOG_ERRORS_5MIN(10)
#
#   CloudShell 은 콘솔에 로그인한 사람의 권한으로 돕니다 — 서버(EC2)에는 경보를 만드는 권한을 주지 않습니다.
# =====================================================================
set -uo pipefail
MODE="${1:-check}"
case "$MODE" in check|apply|test) ;; *) echo "사용: setup.sh [check|apply|test]"; exit 1 ;; esac
export AWS_DEFAULT_REGION="${REGION:-ap-northeast-2}"
EIP="${EIP:-3.37.95.217}"
TOPIC_NAME="sgb-alerts"
CPU_PCT="${CPU_PCT:-80}"; MEM_PCT="${MEM_PCT:-90}"; DISK_PCT="${DISK_PCT:-85}"
STORAGE_FREE_PCT="${STORAGE_FREE_PCT:-15}"; RDS_FREE_MEM_MB="${RDS_FREE_MEM_MB:-200}"; LOG_ERRORS_5MIN="${LOG_ERRORS_5MIN:-10}"

ok()   { echo "  ok   $*"; }
todo() { echo "  할일 $*"; }
warn() { echo "  주의 $*"; }
die()  { echo "!! $*"; exit 1; }
# 바꾸는 명령 — check 에서는 보여 주기만
do_() { if [ "$MODE" = apply ]; then aws "$@" >/dev/null || die "실패: aws $*"; fi; }

command -v aws >/dev/null || die "aws 명령이 없습니다 — AWS CloudShell 에서 실행하십시오"
aws sts get-caller-identity --query Account --output text >/dev/null 2>&1 || die "AWS 로그인 정보가 없습니다 — CloudShell 에서 실행하십시오"
echo "== CloudWatch 경보 ($MODE) · 리전 $AWS_DEFAULT_REGION"

# ── 대상 찾기 ────────────────────────────────────────────────────────
INSTANCE_ID="${INSTANCE_ID:-$(aws ec2 describe-addresses --public-ips "$EIP" --query 'Addresses[0].InstanceId' --output text 2>/dev/null)}"
[ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != None ] || die "탄력적 IP $EIP 에 붙은 EC2 를 찾지 못했습니다 — INSTANCE_ID=i-… 로 주십시오"
ok "EC2 $INSTANCE_ID ($EIP)"
if [ -z "${RDS_ID:-}" ]; then
  ids=$(aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text 2>/dev/null)
  [ "$(echo "$ids" | wc -w)" = 1 ] || die "RDS 가 하나가 아닙니다($ids) — RDS_ID=… 로 주십시오"
  RDS_ID="$ids"
fi
ALLOC_GB=$(aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --query 'DBInstances[0].AllocatedStorage' --output text 2>/dev/null)
[[ "$ALLOC_GB" =~ ^[0-9]+$ ]] || die "RDS $RDS_ID 의 저장 용량을 읽지 못했습니다"
ok "RDS $RDS_ID (저장 ${ALLOC_GB}GB)"

# ── SNS 주제 · 메일 구독 ─────────────────────────────────────────────
TOPIC_ARN=$(aws sns list-topics --query "Topics[?ends_with(TopicArn, ':$TOPIC_NAME')].TopicArn | [0]" --output text 2>/dev/null)
if [ "$MODE" = test ]; then
  [ -n "$TOPIC_ARN" ] && [ "$TOPIC_ARN" != None ] || die "SNS 주제 $TOPIC_NAME 이 없습니다 — 먼저 apply"
  aws cloudwatch set-alarm-state --alarm-name sgb-ec2-cpu --state-value ALARM \
    --state-reason "시험 — setup.sh test (다음 측정 때 OK 로 돌아옴)" || die "sgb-ec2-cpu 경보가 없습니다 — 먼저 apply"
  ok "시험 경보를 보냈습니다 — 1 ~ 2분 안에 「ALARM: sgb-ec2-cpu」 메일, 5분쯤 뒤 「OK」 메일"
  exit 0
fi
body() {
  TOPIC_ARN=$(aws sns list-topics --query "Topics[?ends_with(TopicArn, ':$TOPIC_NAME')].TopicArn | [0]" --output text 2>/dev/null)   # 판마다 새로 찾음(check 판의 가짜 이름을 쓰지 않게)
  if [ -n "$TOPIC_ARN" ] && [ "$TOPIC_ARN" != None ]; then ok "SNS 주제 $TOPIC_NAME 있음"
  else
    todo "SNS 주제 $TOPIC_NAME 만들기"
    if [ "$MODE" = apply ]; then TOPIC_ARN=$(aws sns create-topic --name "$TOPIC_NAME" --query TopicArn --output text) || die "SNS 주제를 만들지 못했습니다"
    else TOPIC_ARN="arn:aws:sns:$AWS_DEFAULT_REGION:ACCOUNT:$TOPIC_NAME"; fi
  fi
  if [ -n "${ALERT_EMAIL:-}" ]; then
    subs=""
    [[ "$TOPIC_ARN" == *:ACCOUNT:* ]] || subs=$(aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --query 'Subscriptions[].[Endpoint,SubscriptionArn]' --output text 2>/dev/null)
    line=$(echo "$subs" | awk -v e="$ALERT_EMAIL" '$1==e')
    if [ -z "$line" ]; then todo "메일 구독 $ALERT_EMAIL — apply 뒤 받은 메일에서 「Confirm subscription」"
      do_ sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ALERT_EMAIL"
    elif [[ "$line" == *PendingConfirmation* ]]; then warn "메일 구독 $ALERT_EMAIL — 확인 전(받은 메일의 「Confirm subscription」을 누르십시오)"
    else ok "메일 구독 $ALERT_EMAIL"; fi
  else
      warn "ALERT_EMAIL 이 없습니다 — apply 에 필요"
  fi

  # ── 로그 그룹 · 오류 줄 지표 필터 ────────────────────────────────────
  # 이름 · 찾는 말(CloudWatch 필터 문법 — 따옴표 안 낱말 · ? 는 「또는」)
  #   API(Nest)  오류 줄은 「ERROR [이름]」 — WARN 은 세지 않음
  #   사용자 웹(Next)  ERROR · Error: · ⨯(Next 의 오류 표시)
  #   배치  「tick 실패」 · JOB_TOKEN 없음(scripts/scheduler-daemon.js)
  #   Nginx  [error] 이상
  FILTERS=(
    "/sgb/api|ApiErrors|\"ERROR\""
    "/sgb/site|SiteErrors|?\"ERROR\" ?\"Error:\" ?\"⨯\""
    "/sgb/jobs|JobsErrors|?\"tick\" ?\"JOB_TOKEN\""
    "/sgb/nginx-error|NginxErrors|?\"[error]\" ?\"[crit]\" ?\"[alert]\" ?\"[emerg]\""
  )
  for f in "${FILTERS[@]}"; do
    IFS='|' read -r grp metric pattern <<<"$f"
    have=$(aws logs describe-log-groups --log-group-name-prefix "$grp" --query "logGroups[?logGroupName=='$grp'].logGroupName | [0]" --output text 2>/dev/null)
    if [ -n "$have" ] && [ "$have" != None ]; then ok "로그 그룹 $grp 있음"
    else todo "로그 그룹 $grp 만들기(보관 30일)"; do_ logs create-log-group --log-group-name "$grp"; fi
    do_ logs put-retention-policy --log-group-name "$grp" --retention-in-days 30
    todo "지표 필터 $grp → SGB/$metric (찾는 말 $pattern)"
    do_ logs put-metric-filter --log-group-name "$grp" --filter-name "sgb-$metric" --filter-pattern "$pattern" \
        --metric-transformations "metricName=$metric,metricNamespace=SGB,metricValue=1,defaultValue=0"
  done

  # ── 경보 ─────────────────────────────────────────────────────────────
  # alarm 이름 · 설명 · 이름공간 · 지표 · 차원 · 통계 · 비교 · 기준 · 기간(초) · 횟수
  alarm() {
    local name=$1 desc=$2 ns=$3 metric=$4 dims=$5 stat=$6 cmp=$7 thr=$8 period=$9 evals=${10}
    todo "경보 $name — $desc"
    # shellcheck disable=SC2086
    do_ cloudwatch put-metric-alarm --alarm-name "$name" --alarm-description "$desc (setup.sh · docs/142)" \
        --namespace "$ns" --metric-name "$metric" ${dims:+--dimensions $dims} --statistic "$stat" \
        --comparison-operator "$cmp" --threshold "$thr" --period "$period" --evaluation-periods "$evals" \
        --treat-missing-data notBreaching --alarm-actions "$TOPIC_ARN" --ok-actions "$TOPIC_ARN"
  }
  E="Name=InstanceId,Value=$INSTANCE_ID"; R="Name=DBInstanceIdentifier,Value=$RDS_ID"
  GE=GreaterThanOrEqualToThreshold; LE=LessThanOrEqualToThreshold
  alarm sgb-ec2-cpu     "서버 CPU ${CPU_PCT}% 이상 5분"        AWS/EC2 CPUUtilization     "$E" Average $GE "$CPU_PCT" 300 1
  alarm sgb-ec2-status  "서버 상태 점검 실패 2분"               AWS/EC2 StatusCheckFailed  "$E" Maximum $GE 1 60 2
  alarm sgb-ec2-mem     "서버 메모리 ${MEM_PCT}% 이상 5분(에이전트)"  CWAgent mem_used_percent "$E" Average $GE "$MEM_PCT" 300 1
  alarm sgb-ec2-disk    "서버 디스크(/) ${DISK_PCT}% 이상(에이전트)"  CWAgent disk_used_percent "$E" Average $GE "$DISK_PCT" 300 1
  alarm sgb-rds-cpu     "DB CPU ${CPU_PCT}% 이상 5분"           AWS/RDS CPUUtilization     "$R" Average $GE "$CPU_PCT" 300 1
  if [[ "${RDS_MAX_CONNECTIONS:-}" =~ ^[0-9]+$ ]]; then
    CONN=$(( RDS_MAX_CONNECTIONS * 8 / 10 ))
    alarm sgb-rds-conn  "DB 연결 ${CONN}개 이상(max_connections ${RDS_MAX_CONNECTIONS} 의 80%)" AWS/RDS DatabaseConnections "$R" Maximum $GE "$CONN" 300 1
  else
    warn "RDS_MAX_CONNECTIONS 가 없습니다 — 연결 수 경보는 apply 때 이 값이 필요"
  fi
  FREE_BYTES=$(( ALLOC_GB * STORAGE_FREE_PCT * 1024 * 1024 * 1024 / 100 ))
  alarm sgb-rds-storage "DB 남은 저장 공간 ${STORAGE_FREE_PCT}% 이하(${ALLOC_GB}GB 중)" AWS/RDS FreeStorageSpace "$R" Minimum $LE "$FREE_BYTES" 300 1
  alarm sgb-rds-mem     "DB 남은 메모리 ${RDS_FREE_MEM_MB}MB 이하 10분" AWS/RDS FreeableMemory "$R" Minimum $LE $(( RDS_FREE_MEM_MB * 1024 * 1024 )) 300 2
  for m in ApiErrors SiteErrors JobsErrors NginxErrors; do
    alarm "sgb-log-$(echo "$m" | sed 's/Errors$//' | tr '[:upper:]' '[:lower:]')" "$m 오류 줄 5분에 ${LOG_ERRORS_5MIN}건 이상" SGB "$m" "" Sum $GE "$LOG_ERRORS_5MIN" 300 1
  done
}

# ── 끝 ───────────────────────────────────────────────────────────────
if [ "$MODE" = check ]; then
  body
  have=$(aws cloudwatch describe-alarms --alarm-name-prefix sgb- --query 'length(MetricAlarms)' --output text 2>/dev/null)
  echo "== check 끝 — 지금 있는 sgb-* 경보 ${have:-0}개 · 위 「할일」을 apply 가 만듭니다(같은 이름은 덮어씀)"
  exit 0
fi
# apply — 먼저 만들 것을 보여 주고(check 와 같음) 묻은 뒤 만듭니다
[ -n "${ALERT_EMAIL:-}" ] || die "ALERT_EMAIL 이 없습니다"
[[ "${RDS_MAX_CONNECTIONS:-}" =~ ^[0-9]+$ ]] || die "RDS_MAX_CONNECTIONS 가 없습니다 — 서버에서 psql.sh -c 'SHOW max_connections' 값을 주십시오"
MODE=check; body
read -r -p "위 것을 만들까요? 만들려면 소문자 yes: " a; [ "$a" = yes ] || { echo "그만둠 — 아무것도 바꾸지 않았습니다"; exit 1; }
MODE=apply; echo "== 만드는 중"; body
have=$(aws cloudwatch describe-alarms --alarm-name-prefix sgb- --query 'length(MetricAlarms)' --output text 2>/dev/null)
echo "== apply 끝 — sgb-* 경보 ${have:-?}개 · 메일 구독을 확인(Confirm)한 뒤 bash setup.sh test 로 시험 메일"
