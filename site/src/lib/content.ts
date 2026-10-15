import { apiGet } from './api';

/**
 * 서버가 관리하는 콘텐츠.
 *
 * FAQ · 문의 분류 · 분쟁 사유 · 등록 폼 문구 · 화면 고정 문구는
 * 전부 관리자가 바꿉니다. 화면에 하드코딩하면 문구 하나 고치는 데
 * 배포가 필요해지고, 법정 고지 문구라면 그게 곧 위반 기간이 됩니다.
 */
export interface CodeEntry { code: string; label: string; tone?: string | null }
export interface FormCopy {
  role: 'OFFER' | 'REQUEST';
  subject: string; titleHint: string; bodyHint: string; notice: string | null;
}
export interface Faq {
  category: string; question: string; answer: string;
  /* v10.31 (D048) — 챗봇 낱말 · 「…에서 보기」 · 상담원 연결 */
  keywords?: string[]; linkHref?: string | null; linkLabel?: string | null; handoff?: boolean;
}

/** 화면 고정 문구. 없으면 빈 문자열 — 문구가 안 나오는 게 틀린 문구보다 낫습니다 */
export async function uiMessages(): Promise<Record<string, string>> {
  return apiGet<Record<string, string>>('/ui-messages', 300).catch(() => ({}));
}

export async function codeList(domain: string): Promise<CodeEntry[]> {
  const bundle = await apiGet<{ domains: Record<string, CodeEntry[]> }>('/codes', 300)
    .catch(() => ({ domains: {} as Record<string, CodeEntry[]> }));
  return bundle.domains[domain] ?? [];
}

/** v10.31 — channel: FAQ(기본 · 고객센터) · CS(시안 고객센터 화면) · GUIDE(이용안내) · BOT(1:1 문의 챗봇) */
export const faqs = (gwanCode?: string, channel?: 'FAQ' | 'CS' | 'GUIDE' | 'BOT') => {
  const qs = new URLSearchParams();
  if (gwanCode) qs.set('gwanCode', gwanCode);
  if (channel) qs.set('channel', channel);
  const t = qs.toString();
  return apiGet<Faq[]>(`/faq${t ? `?${t}` : ''}`, 300).catch(() => [] as Faq[]);
};

export const formCopy = (gwanCode: string) =>
  apiGet<FormCopy[]>(`/gwans/${gwanCode}/form-copy`, 300).catch(() => []);
