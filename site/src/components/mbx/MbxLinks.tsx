/**
 * v10.501 ~ 504 (D273 · docs/639 ~ 642) — 나의공간 › 관심 목록 아래 「함께 쓰기」 줄(서버 부품)
 *   켜진 기능만: 최근 본(/recent) · 비교하기(/compare) · 가격 알림(/my/price-alerts) · 회원 대화(/my/messages)
 *   넷 다 꺼져 있으면(처음) 아무것도 그리지 않음 — 나의공간 메뉴(MY_GROUPS)는 고치지 않음(옛 시험 test_v1253 이 메뉴 열쇠를 글자로 봄)
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGetPublic } from '@/lib/api';
import '@/styles/mbx.css';

export async function MbxLinks() {
  const sw = await apiGetPublic<{ recent: boolean; compare: boolean; priceAlert: boolean; dm: boolean }>('/site/mbx/switches', 60)
    .catch(() => ({ recent: false, compare: false, priceAlert: false, dm: false }));
  if (!sw.recent && !sw.compare && !sw.priceAlert && !sw.dm) return null;
  const t = await getTranslations('mbx.likesLinks');
  return (
    <div className="mbx-tools" data-mbx-links="">
      <span className="mbx-msg">{t('head')}</span>
      {sw.recent && <Link className="mbx-btn" href="/recent">{t('recent')}</Link>}
      {sw.compare && <Link className="mbx-btn" href="/compare">{t('compare')}</Link>}
      {sw.priceAlert && <Link className="mbx-btn" href="/my/price-alerts">{t('price')}</Link>}
      {sw.dm && <Link className="mbx-btn" href="/my/messages">{t('messages')}</Link>}
    </div>
  );
}
