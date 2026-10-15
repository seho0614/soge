import Link from 'next/link';
import { apiGet } from '@/lib/api';

interface Term { code: string; title: string; isNotice?: boolean }

/**
 * v10.28 (G-218 · 10/9 답 「알림으로」 · D042) — 알림(동의를 받지 않는 안내).
 * 개인정보 처리 위탁은 동의 항목이 아니라 맡기는 곳 · 일을 공개하는 것(개인정보 보호법 제26조)이라
 * 가입 · 약관 동의 화면에 동의 칸 대신 「보기」 링크 한 줄로 둡니다.
 */
export async function NoticeTerms() {
  const terms = await apiGet<Term[]>('/terms', 60).catch(() => [] as Term[]);
  const list = terms.filter((t) => t.isNotice);
  if (!list.length) return null;
  return (
    <p className="hint" data-notice-terms>
      <b>알림</b>{' '}
      {list.map((t, i) => (
        <span key={t.code}>{i > 0 && ' · '}<Link href={`/terms/${t.code}`} data-notice-term={t.code}>{t.title}</Link></span>
      ))}
      {' '}— 동의를 받는 항목이 아니라 알려 드리는 안내입니다. 따로 고르실 것이 없습니다.
    </p>
  );
}
