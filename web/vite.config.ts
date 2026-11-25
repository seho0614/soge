import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* e1.4 (docs/004) ERP 화면 — /api 는 ERP API 로(점검판 erp-api:3100 · 환경 변수 ERP_API_ORIGIN) */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { '/api': { target: process.env.ERP_API_ORIGIN || 'http://localhost:3100', changeOrigin: true } },
  },
});
