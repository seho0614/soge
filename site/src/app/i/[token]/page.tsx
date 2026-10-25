import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { dtKst } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { InviteConsent } from '@/components/InviteConsent';
import { Msgs } from '@/i18n/Msgs';
import { getTranslations } from 'next-intl/server';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('deal.meta'))('invite') };
}

type Props = { params: Promise<{ token: string }> };

/** 서버 GET /invites/{token} 의 모양 그대로(v10.31). v10.30 까지 화면이 introducerName · listingTitle · requestTitle 을 읽어 빈칸이었습니다(결함 상). */
type Invite = {
  state: 'SENT' | 'VIEWED' | 'CONSENTED' | 'DECLINED' | 'EXPIRED';
  expired: boolean; expiresAt: string;
  title: string; body: string | null; gwanName: string | null; region: string | null; categoryName: string | null;
  introducer: string; gradeLabel: string | null; introducerValid: number | null;
  effects?: string[]; note?: string;
};

/**
 * SB-HOM-INV-010 초대 확인 · 동의 — v10.31 시안 scInviteConsent 그대로.
 *   소개하는 분(이름 첫 글자 · 등급 · 유효 연결) · 「어떤 요청입니까」(제목 · 지역 · 업종 · 내용) · 「동의하시면 이렇게 됩니다」 ·
 *   연락처 안내 · 거절 안내(만료일) · 동의하고 연결 / 거절 · 링크 유효 기한 + 중개자 고지.
 *
 * ── 비회원도 봅니다 ── 무엇에 초대받았는지 먼저 보여 주고, 동의할 때 가입을 안내합니다.
 *   로그인한 분이 동의하면 요청자와의 1:1 대화가 바로 열립니다(서버 v10.31).
 */
export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  /* 열람 표시(VIEWED)를 남기는 호출이라 캐시하지 않습니다 */
  const inv = await apiGetPersonal<Invite>(`/invites/${encodeURIComponent(token)}`).catch(() => null);
  if (!inv) notFound();

  const expired = inv.expired || inv.state === 'EXPIRED';
  const until = dtKst(inv.expiresAt);
  const t = await getTranslations('deal.invite');
  const effects = inv.effects?.length ? inv.effects : [t('effects.chat'), t('effects.own'), t('effects.log'), t('effects.stop')];

  return (
    <div className="w1 w1-wrap w1-inv" data-screen="SB-HOM-INV-010">{/* v10.32 — 시안 폭 · 「동의하시면」 3열 */}
      <BackBar href="/" label={t('back')} wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>{t('title')}</h1>
        <p>{t('lead')}</p>
      </div>

      <div className="w1-panel" style={{ padding: '14px 16px', marginTop: 12 }}>
        <span className="w1-ls">{t('who')}</span>
        <div style={{ fontSize: 16, fontWeight: 800, margin: '2px 0' }}>{inv.introducer}</div>
        <span className="w1-ls">{inv.gradeLabel ?? t('introducer')} · {t('valid', { n: String(inv.introducerValid ?? 0) })}</span>
      </div>

      <h2 className="w1-h2" style={{ marginTop: 20 }}>{t('what')}</h2>
      <div className="w1-panel" style={{ padding: '14px 16px' }} data-invite-request>
        <b style={{ fontSize: 14 }}>{inv.title}</b>
        <p className="w1-ls" style={{ margin: '4px 0 8px' }}>{[inv.gwanName, inv.region, inv.categoryName].filter(Boolean).join(' · ')}</p>
        {inv.body && <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--ink-2)' }}>{inv.body}</p>}
      </div>

      <h2 className="w1-h2" style={{ marginTop: 20 }}>{t('effectsTitle')}</h2>
      <ul className="w1-eff3">{effects.map((x) => <li key={x}>{x}</li>)}</ul>

      <div className="w1-nt">{t.rich('contact', { b: (x) => <b>{x}</b> })}</div>
      <div className="w1-nt warn" style={{ marginTop: 8 }}>{t.rich('noPenalty', { until, b: (x) => <b>{x}</b> })}</div>

      <div style={{ marginTop: 14 }}>
        {expired ? (
          <div className="w1-nt warn">{t.rich('expired', { b: (x) => <b>{x}</b> })}</div>
        ) : inv.state === 'DECLINED' ? (
          <div className="w1-nt">{t('declined')}</div>
        ) : (
          <Msgs ns={['deal']}><InviteConsent token={token} introducer={inv.introducer} consented={inv.state === 'CONSENTED'} /></Msgs>
        )}
      </div>

      <p className="w1-ls" style={{ marginTop: 14 }}>{t('foot', { until })}</p>
    </div>
  );
}
