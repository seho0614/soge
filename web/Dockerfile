# ERP 화면 (e1.4 · docs/004) — 점검판 구동용 Vite · /api 를 erp-api:3100 으로 프록시
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
EXPOSE 5175
CMD ["npx","vite","--host","0.0.0.0","--port","5175"]
