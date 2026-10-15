# 관리자 콘솔 (Vite). /api 를 api:3000 으로 프록시합니다.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
EXPOSE 5173
# --host 가 없으면 컨테이너 밖에서 접속되지 않습니다.
CMD ["npx","vite","--host","0.0.0.0","--port","5173"]
