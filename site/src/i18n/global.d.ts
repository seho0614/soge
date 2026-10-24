/* v10.95 — 사전 키 형식 검사: 한국어 사전에 없는 키를 쓰면 형식 검사(tsc)가 잡습니다 · v10.97 묶음 파일까지(messages/index.ts) */
import type { KO } from './messages';

declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof KO;
  }
}
