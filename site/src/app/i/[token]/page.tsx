import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { dtKst } from '@/lib/format';
import { BackBar } from '@/components/common/BackBar';
import { InviteConsent } from '@/components/InviteConsent';
import '@/styles/proto-w1.css';

export const metadata: Metadata = { title: '소개 확인' };

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
  const effects = inv.effects?.length ? inv.effects : ['요청하신 분과 대화가 열립니다', '회원님이 직접 입력하신 정보만 전달됩니다', '동의 사실과 시각이 기록으로 남습니다', '언제든 대화를 그만두실 수 있습니다'];

  return (
    <div className="w1 w1-wrap w1-inv" data-screen="SB-HOM-INV-010">{/* v10.32 — 시안 폭 · 「동의하시면」 3열 */}
      <BackBar href="/" label="메인" wrap={false} />
      <div className="w1-aih" style={{ marginTop: 10 }}>
        <h1>소개 요청을 확인해 주세요</h1>
        <p>소개뱅크 회원이 아니어도 확인하실 수 있습니다. 동의하지 않으시면 아무 일도 일어나지 않습니다.</p>
      </div>

      <div className="w1-panel" style={{ padding: '14px 16px', marginTop: 12 }}>
        <span className="w1-ls">소개하는 분</span>
        <div style={{ fontSize: 17, fontWeight: 800, margin: '2px 0' }}>{inv.introducer}</div>
        <span className="w1-ls">{inv.gradeLabel ?? '소개자'} · 유효 연결 {inv.introducerValid ?? 0}건</span>
      </div>

      <h2 className="w1-h2" style={{ marginTop: 20 }}>어떤 요청입니까</h2>
      <div className="w1-panel" style={{ padding: '14px 16px' }} data-invite-request>
        <b style={{ fontSize: 15 }}>{inv.title}</b>
        <p className="w1-ls" style={{ margin: '4px 0 8px' }}>{[inv.gwanName, inv.region, inv.categoryName].filter(Boolean).join(' · ')}</p>
        {inv.body && <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--ink-2)' }}>{inv.body}</p>}
      </div>

      <h2 className="w1-h2" style={{ marginTop: 20 }}>동의하시면 이렇게 됩니다</h2>
      <ul className="w1-eff3">{effects.map((x) => <li key={x}>{x}</li>)}</ul>

      <div className="w1-nt"><b>지금은 요청자가 회원님의 연락처를 알지 못합니다.</b> 동의하신 뒤에야 대화가 열리고, 그때도 연락처는 회원님이 직접 입력하시는 것만 전달됩니다.</div>
      <div className="w1-nt warn" style={{ marginTop: 8 }}><b>거절하셔도 불이익이 없습니다.</b> 소개하신 분에게는 거절 사실만 전달되고 사유는 묻지 않습니다. 답하지 않으시면 {until}에 자동으로 만료됩니다.</div>

      <div style={{ marginTop: 14 }}>
        {expired ? (
          <div className="w1-nt warn"><b>이 초대는 기한이 지났습니다.</b> 소개자에게 다시 보내 달라고 요청하십시오.</div>
        ) : inv.state === 'DECLINED' ? (
          <div className="w1-nt">이미 거절하신 초대입니다.</div>
        ) : (
          <InviteConsent token={token} introducer={inv.introducer} consented={inv.state === 'CONSENTED'} />
        )}
      </div>

      <p className="w1-ls" style={{ marginTop: 14 }}>이 링크는 {until}까지 유효합니다. 소개뱅크는 통신판매중개자이며 거래의 당사자가 아닙니다.</p>
    </div>
  );
}
