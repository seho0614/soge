#!/bin/bash
# 외부 연동 어댑터 시험용 API 인스턴스 3개 + 가짜 서버 (공용 3000 과 별개, 같은 개발 DB)
#   3121 토스 모드 (가짜 토스는 srv_pay.py 가 3129 로 띄움)
#   3122 S3 모드   (가짜 S3 는 srv_file.py 가 9022 로 띄움)
#   3123 1원 인증 · 중개사 대조 · 국세청 모드 (가짜 서버 srv_lead_mock.py 13023)
#   3124 NODE_ENV=staging (v10.11 — 인증번호가 응답으로 나가지 않는지)
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
cd /home/claude/qa
for f in /tmp/adp_*.pid; do [ -f "$f" ] && kill $(cat $f) 2>/dev/null; rm -f "$f"; done
sleep 1
setsid python3 srv_lead_mock.py 13023 > /tmp/adp_mock.log 2>&1 < /dev/null & echo $! > /tmp/adp_mock.pid
BASE="DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef NODE_ENV=development"
cd $K
env $BASE PORT=3121 TOSS_SECRET_KEY=test_sk_mock TOSS_API_BASE=http://localhost:3129 setsid node scripts/dev-server.js > /tmp/adp_toss.log 2>&1 < /dev/null & echo $! > /tmp/adp_toss.pid
env $BASE PORT=3122 S3_BUCKET=sgb-test S3_ENDPOINT=http://127.0.0.1:9022 S3_FORCE_PATH_STYLE=1 AWS_ACCESS_KEY_ID=AKIDSGBTEST AWS_SECRET_ACCESS_KEY=sgb-test-secret-key AWS_REGION=ap-northeast-2 FILE_DOWNLOAD_TTL=3 setsid node scripts/dev-server.js > /tmp/adp_s3.log 2>&1 < /dev/null & echo $! > /tmp/adp_s3.pid
( . /home/claude/qa/srv_lead_adp.env.sh; env $BASE PORT=3123 setsid node scripts/dev-server.js > /tmp/adp_lead.log 2>&1 < /dev/null & echo $! > /tmp/adp_lead.pid )
# 3124 개발이 아닌 환경(staging) — 알림톡 연동 전에는 상담 신청을 받지 않는지 확인용 (srv_consult.py E 절)
env ${BASE/NODE_ENV=development/NODE_ENV=staging} PORT=3124 setsid node scripts/dev-server.js > /tmp/adp_stg.log 2>&1 < /dev/null & echo $! > /tmp/adp_stg.pid
for p in 3121 3122 3123 3124; do for i in $(seq 1 90); do curl -fsS localhost:$p/api/v1/health >/dev/null 2>&1 && break; sleep 1; done; echo "adp $p $(curl -s -o /dev/null -w '%{http_code}' localhost:$p/api/v1/health)"; done
