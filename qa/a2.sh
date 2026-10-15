#!/bin/bash
# 1구간의 매트릭스 · 흐름 시험을 마지막 코드로 다시 — final_all.txt 의 그 줄을 새 결과로 바꿉니다(검정 DB · 통합 검정은 verify_rerun.sh 가 따로 함).
K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb; cd /home/claude/qa
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
put(){ python3 - "$1" "$2" <<'P'
import sys
k, v = sys.argv[1], sys.argv[2]; L = open('final_all.txt', encoding='utf-8').read().split('\n'); hit = 0
for i, l in enumerate(L):
    if l.split(': ', 1)[0] == k: L[i] = f'{k}: {v}'; hit += 1
assert hit == 1, (k, hit)
open('final_all.txt', 'w', encoding='utf-8').write('\n'.join(L)); print(f'{k}: {v}')
P
}
put matrix "$(cd $K && DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb npm run matrix 2>&1 | tail -2 | tr '\n' ' ')"
put cut_b2 "$(python3 cut_b2.py --check 2>&1 | tail -1)"
API=http://localhost:3000/api/v1 python3 fixtures.py > fixtures.log 2>&1; put fixtures "$(tail -1 fixtures.log)"
for s in e2e decisions decisions_ui fixes_1002; do python3 $s.py > final_$s.log 2>&1; put $s "$(tail -1 final_$s.log)"; done
echo A2-DONE
