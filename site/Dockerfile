# 사용자 웹 (Next.js). /api 를 api:3000 으로 프록시합니다.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
EXPOSE 5174
CMD ["npx","next","dev","-H","0.0.0.0","-p","5174"]
