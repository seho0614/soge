#!/bin/bash
# 사용자 웹(5174)을 **운영 방식**(next build → next start)으로 다시 띄웁니다. v10.30
#   화면 코드를 고친 뒤에 돌립니다. 지난 빌드의 조회 캐시(.next/cache/fetch-cache)를 지워, 고치기 전 응답이 섞이지 않게 합니다.
K=${KIT:-/home/claude/pkg/SGB_DevDocker_Integrated_20261002}
cd $K/sgb/site || exit 1
pkill -f "next start -p 5174" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 1
rm -rf .next/cache/fetch-cache
API_BASE=http://localhost:3000/api/v1 API_ORIGIN=http://localhost:3000 npx next build > /tmp/site_build.log 2>&1 || { echo "build FAILED"; tail -30 /tmp/site_build.log; exit 1; }
API_BASE=http://localhost:3000/api/v1 API_ORIGIN=http://localhost:3000 nohup npx next start -p 5174 > /tmp/site.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null -m 2 http://localhost:5174/ && break; sleep 1; done
echo "site: / → $(curl -s -o /dev/null -w '%{http_code}' -m 10 http://localhost:5174/) · /money → $(curl -s -o /dev/null -w '%{http_code}' -m 10 http://localhost:5174/money)"
