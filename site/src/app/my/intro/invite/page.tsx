import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { InviteForm, type ReqOpt } from './InviteForm';
import { ymdKst } from '@/lib/format';
import { MyHead } from '@/components/my/ui';

export const metadata: Metadata = { title: '소개 초대' };

interface Invite {
  id: string; label: string; state: string; channel?: string;
  createdAt: string; expiresAt: string; request: string; channelLabel?: string | null;
}
interface Channel { channel: string; ready: boolean; note: string }
interface Matched { requestId?: string; id?: string; title?: string; summary?: string }

const STATE: Record<string, string> = {
  SENT: '확인 대기', VIEWED: '열람함', CONSENTED: '동의 완료',
  DECLINED: '거절', EXPIRED: '만료',
};
const CH: Record<string, string> = { SELF: '직접 전달', SMS: '문자', ALIMTALK: '알림톡', EMAIL: '이메일' };

/**
 * SB-MYP-INT-020
 *
 * 기본은 **소개자 직접 전달**입니다 — 플랫폼이 연락처를 받지 않습니다.
 * v10.29 — 시안(scIntroInvite) 배치 · 오른쪽 위 「수락 n / 보낸 수」 · 보낸 초대 표(상대방 · 요청 · 전달 · 상태 · 보낸 날).
 */
export default async function InvitePage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const p = await me();
  if (!p) redirect('/login');
  const want = (await searchParams).request ?? '';

  const [invites, channels, matched] = await Promise.all([
    apiGet<Invite[]>('/me/introducer/invites', 0).catch(() => [] as Invite[]),
    apiGet<Channel[]>('/me/introducer/channels', 300).catch(() => [] as Channel[]),
    /* v10.31 — 「제가 알아요」로 답한 요청은 맞춤 목록에서 빠지므로 답한 요청(answered)도 고를 수 있게 함께 받습니다 */
    apiGet<{ items?: Matched[]; answered?: Matched[] } | Matched[]>('/me/introducer/matched', 0)
      .then((r) => (Array.isArray(r) ? r : [...(r?.answered ?? []), ...(r?.items ?? [])])).catch(() => [] as Matched[]),
  ]);
  const consented = invites.filter((i) => i.state === 'CONSENTED').length;
  const reqs: ReqOpt[] = matched.map((m) => ({ id: m.requestId ?? m.id ?? '', title: m.title ?? m.summary ?? '(제목 없음)' })).filter((r) => r.id);
  const initial = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(want) ? want : '';

  return (
    <><div data-intro-invite="">
      <MyHead title="소개 초대"
        sub="아는 곳에 링크를 보내 의사를 물어봅니다. 상대방이 동의하기 전에는 연락처가 요청자에게 전달되지 않습니다."
        right={<span className="my-ls">수락 {consented} / {invites.length}</span>} />

      <InviteForm channels={channels} requests={reqs} initialRequest={initial} />

      <h2 className="my-s2">보낸 초대 <em>{invites.length}</em></h2>
      {invites.length === 0 ? (
        <p className="my-ls">아직 보낸 초대가 없습니다.</p>
      ) : (
        <div className="my-tbl-w">
          <table className="my-tbl">
            <thead><tr><th>상대방</th><th>요청</th><th>전달</th><th>상태</th><th>보낸 날</th></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.label}</b></td>
                  <td className="my-ls">{i.request}</td>
                  <td className="my-ls">{i.channelLabel ?? (i.channel ? CH[i.channel] ?? i.channel : '—')}</td>
                  <td><span className={`my-bg ${i.state === 'CONSENTED' ? 'ok' : i.state === 'DECLINED' ? 'no' : i.state === 'EXPIRED' ? 'off' : 'wait'}`}>{STATE[i.state] ?? i.state}</span></td>
                  <td className="my-ls">{ymdKst(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
