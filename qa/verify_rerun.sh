#!/bin/bash
# 통합 검정을 처음부터 다시(검정 DB 를 새로 만듦) — final_parts.sh A 의 verify 줄과 같은 명령. 결과는 final_all.txt 에 verify_rerun 으로 남깁니다.
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb; cd /home/claude/qa
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS sgb_check' -c 'CREATE DATABASE sgb_check OWNER sgb'" >/dev/null 2>&1
(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb_check timeout 900 npm run verify > /tmp/verify.log 2>&1); rc=$?
echo "verify_rerun: exit=$rc $(grep -E '^통과 [0-9]+ / 실패' /tmp/verify.log | head -1) | $(grep -E '뚫림' /tmp/verify.log | head -1) | $(grep 'SQL 대조' /tmp/verify.log)   (${1:-다시})" >> final_all.txt
echo VERIFY-RERUN-DONE
