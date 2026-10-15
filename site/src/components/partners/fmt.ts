import { dtKst, ymdKst } from '@/lib/format';
/* 파트너센터 화면 공용 표기. 금액은 bigint 라 문자열로 올 수 있어 Number 로 한 번 거릅니다. */

export const krw = (n: number | string | null | undefined) =>
  n == null || n === '' ? '—' : Number(n).toLocaleString('ko-KR') + '원';

export const ymd = (iso: string | null | undefined) =>
  iso ? ymdKst(iso) : '—';

export const ymdhm = (iso: string | null | undefined) =>
  iso ? dtKst(iso) : '—';

/* 상태 → 한국어 · 표시 등급. 서버 코드를 그대로 보이지 않습니다. */
export const ORDER_STATE: Record<string, { t: string; c: string }> = {
  PENDING:   { t: '확인 중', c: 'state-in_review' },
  CONFIRMED: { t: '확정',   c: 'state-published' },
  SETTLED:   { t: '정산됨', c: 'state-published' },
  CANCELED:  { t: '취소',   c: 'state-rejected' },
};

export const SETTLE_STATE: Record<string, { t: string; c: string }> = {
  DRAFT:     { t: '확정 대기', c: 'state-in_review' },
  CONFIRMED: { t: '지급 대기', c: 'state-in_review' },
  PAID:      { t: '지급 완료', c: 'state-published' },
  CARRIED:   { t: '이월',     c: 'state-suspended' },
};

export const INQ_STATE: Record<string, { t: string; c: string }> = {
  OPEN:     { t: '확인 중',   c: 'state-in_review' },
  ANSWERED: { t: '답변 완료', c: 'state-published' },
  CLOSED:   { t: '종료',     c: 'state-suspended' },
};

export const TRACK: Record<string, string> = { AFFILIATE: '제휴수수료', REFERRAL: '소개비' };

export const MATERIAL_KIND: Record<string, string> = {
  IMAGE: '이미지', BANNER: '배너', COPY: '카피', VIDEO: '영상', DOC: '문서',
};
