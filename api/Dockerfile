# =====================================================================
# ERP API (e1.1 · docs/001) — 점검판 구동용(운영 서버는 도커를 쓰지 않음 · 소개뱅크 Dockerfile 과 같은 방식)
# =====================================================================
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY VERSION /app/VERSION
COPY prisma /app/prisma
COPY api/ ./
ENV NODE_ENV=development PORT=3100
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=6 \
  CMD curl -fsS http://localhost:3100/api/v1/health || exit 1
CMD ["sh", "-c", "node scripts/migrate.js && node scripts/dev-server.js"]
