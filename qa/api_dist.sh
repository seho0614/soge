#!/bin/bash
# 10/3 (v10.16) — API 를 **운영과 같은 방식**으로 띄웁니다: tsc 로 빌드한 dist/main.js (개발 서버 scripts/dev-server.js 가 아님).
#   다른 점 두 가지 — ① 정의에 없는 입력 항목이 섞이면 400(forbidNonWhitelisted · 개발 서버는 조용히 버림) ② /docs 없음.
#   NODE_ENV 는 development 로 둡니다(개발 계정 · 개발용 인증번호를 쓰는 시험이 있어서). 운영 값(production)으로는 aws_rehearsal.sh 가 봅니다.
cd /home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
[ -f /tmp/api.pid ] && kill $(cat /tmp/api.pid) 2>/dev/null
for p in $(ps -eo pid,args | awk '$2=="node" && ($3=="scripts/dev-server.js" || $3=="dist/main.js"){print $1}'); do [ "$(readlink -f /proc/$p/cwd)" = "$(pwd)" ] && kill $p; done
sleep 1
npm run build > /tmp/api_build.log 2>&1 || { echo "build FAILED"; tail -20 /tmp/api_build.log; exit 1; }
export DATABASE_URL=${DATABASE_URL:-postgresql://sgb:sgb@localhost:5432/sgb} JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef PORT=3000 NODE_ENV=development
setsid node dist/main.js > /tmp/api.log 2>&1 < /dev/null &
echo $! > /tmp/api.pid
for i in $(seq 1 60); do curl -fsS localhost:3000/api/v1/health >/dev/null 2>&1 && { echo "api(dist) up ${i}s"; exit 0; }; sleep 1; done
echo "api FAILED"; tail -20 /tmp/api.log; exit 1
