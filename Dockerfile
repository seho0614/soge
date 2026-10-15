# =====================================================================
# 소개뱅크 API · 배치
#
# 빌드 없이 ts-node 로 띄웁니다. 개발 서버와 같은 방식이라
# "로컬에선 되는데 컨테이너에선 안 된다"가 줄어듭니다.
#
# 운영 이미지는 별도입니다 — 여기는 구동 테스트용입니다.
# =====================================================================
FROM node:22-slim

# psql · pg_dump 가 필요합니다. 마이그레이션과 검정이 씁니다.
# python3 — 검정(check-testsafety.sh)이 씁니다. node:22-slim 에는 없어 검정 컨테이너가 「▲위험」으로 끝났습니다
#           (10/2 docker compose 실구동에서 발견).
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client curl ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성을 먼저 넣어 캐시가 살아 있게 합니다.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ENV NODE_ENV=development
EXPOSE 3000

# 컨테이너가 살아 있다고 API 가 도는 것은 아닙니다. 실제로 물어봅니다.
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD curl -fsS http://localhost:3000/api/v1/health || exit 1

CMD ["node", "scripts/dev-server.js"]
