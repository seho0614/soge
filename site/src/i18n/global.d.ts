/* v10.95 — 사전 키 형식 검사: 한국어 사전(ko.json)에 없는 키를 쓰면 형식 검사(tsc)가 잡습니다 */
import ko from './messages/ko.json';

declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof ko;
  }
}
