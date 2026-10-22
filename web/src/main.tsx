import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { captureRef } from './lib/api';
import './styles/sgb-tokens.css';   // v10.67 — 디자인 시트(사용자 웹과 같은 파일)
import './styles/admin-fonts.css';
import './styles/tokens.css';
import './styles/app.css';

// 최초 유입은 ?ref= 로 옵니다. 저장해 두고 이후 요청부터 헤더로 보냅니다 (INV-2)
captureRef();

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // 409·422 는 재시도해도 같은 결과입니다
      retry: (count, err: unknown) => {
        const s = (err as { status?: number })?.status;
        if (s && s < 500) return false;
        return count < 2;
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}><App /></QueryClientProvider>
  </StrictMode>,
);
