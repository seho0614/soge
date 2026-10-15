import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': '/src' } },
  server: {
    port: 5173,
    // BO 는 SPA. API 는 web-api 태스크로 프록시합니다
    // 컨테이너에서는 localhost 가 자기 자신입니다. 환경변수로 빼 둡니다 —
    // 고정하면 도커로 띄울 때 프런트가 API 를 찾지 못합니다.
    proxy: { '/api': { target: process.env.API_ORIGIN || 'http://localhost:3000',
                       changeOrigin: true } },
  },
});
