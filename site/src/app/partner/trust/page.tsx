import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { Bg, Empty, Note, Pgh } from '@/components/partner/ui';

export const metadata: Metadata = { title: '신뢰지표' };

interface T {
  total: number; viewed: number;
  avgViewMin: number | null; viewRate: number | null;
  badges?: Array<{ code: string; name: string; state: string; detail: string | null }>;
}
const BADGE_TONE: Record<string, 'ok' | 'wait' | 'no' | 'off'> = { '달성': 'ok', '심사중': 'wait', '반려': 'no' };

/**
 * SB-PTC-CTR-600 신뢰지표 — v10.29 시안 scPtnTrust 배치(조건 줄 .crow + 상태 배지 → 안내)
 *
 * 리드를 받아 놓고 열어 보지 않으면 **요청자가 그동안 기다립니다.** 숫자를 보여 주어야 고칠 수 있습니다.
 * v10.31 (W5 · 10/10 시안 기준) — 시안의 줄 「배지 이름 · 조건 · 상태」를 서버 배지(fn_partner_badges — 조건이 만들고 사라지면 내려감)로 먼저 두고,
 *   개발에만 있던 실제 지표 3가지(받은 리드 · 열람률 · 평균 열람)는 아래에 그대로 둡니다. 「누적 ○○」 라벨은 업종별입니다.
 */
export default async function TrustPage() {
  const p = await me();
  if (!p) redirect('/login');

  const t = await apiGet<T>('/partner/trust', 0).catch(() => null);
  if (!t) return <><Pgh title="신뢰지표" /><Empty>파트너가 아닙니다.</Empty><i hidden data-root-end="" /></>;

  const slow = (t.avgViewMin ?? 0) > 180;
  const low = (t.viewRate ?? 100) < 60;
  const avg = t.avgViewMin == null ? '—' : t.avgViewMin < 60 ? `${t.avgViewMin}분` : `${Math.round(t.avgViewMin / 60)}시간`;

  return (
    <><Pgh title="신뢰지표" sub="배지는 조건이 만들고, 조건이 사라지면 자동으로 내려갑니다." />
      {(t.badges ?? []).map((b) => (
        <div className="pt-crow" key={b.code} data-badge={b.code}>
          <div><b>{b.name}</b><span className="pt-ls">{b.detail ?? ''}</span></div>
          <Bg tone={BADGE_TONE[b.state] ?? 'off'}>{b.state}</Bg>
        </div>
      ))}
      <Note kind="info"><b>배지는 파트너가 켜고 끄는 것이 아니라 조건이 만듭니다.</b> 조건이 사라지면 배지도 자동으로 내려갑니다.</Note>
      {/* v10.32 — 시안의 「업종별 라벨」 노란 띠 자리. 시안 문구(아직 갈리지 않음)는 개발 현황 메모라, 실제 규칙(서버 배지 이름이 업종별)을 적습니다 */}
      <Note kind="warn" data-trust-label=""><b>업종별 라벨</b><br />「누적 ○○」 배지 이름은 승인된 서비스가 가장 많은 업종의 라벨을 따릅니다(라벨이 없는 업종이 많으면 「누적 성사」) — 태양광 전용 「누적 시공」 같은 라벨이 다른 업종에 섞여 붙지 않게 합니다.</Note>
      <h2 className="pt-s2">응답 지표</h2>
      <p className="pt-ls" style={{ margin: '0 0 8px' }}><b>낮으면 리드가 덜 옵니다.</b> 받아 놓고 응답하지 않으면 요청자가 기다리게 되기 때문입니다.</p>

      <div className="pt-crow">
        <div><b>받은 리드</b><span className="pt-ls">지금까지 배정받은 상담 신청</span></div>
        <div><span className="v">{t.total}건</span></div>
      </div>
      <div className="pt-crow">
        <div><b>열람률</b><span className="pt-ls">받은 리드 중 연락처를 연 비율 — 60% 아래면 배정에서 뒤로 밀립니다</span></div>
        <div><span className="v">{t.viewRate ?? '—'}{t.viewRate != null ? '%' : ''}</span><Bg tone={low ? 'no' : 'ok'}>{low ? '낮음' : '적정'}</Bg></div>
      </div>
      <div className="pt-crow">
        <div><b>평균 열람 시간</b><span className="pt-ls">받고 나서 열기까지 — 3시간을 넘기면 요청자가 다른 곳과 먼저 이야기합니다</span></div>
        <div><span className="v">{avg}</span><Bg tone={t.avgViewMin == null ? 'off' : slow ? 'no' : 'ok'}>{t.avgViewMin == null ? '기록 없음' : slow ? '느림' : '적정'}</Bg></div>
      </div>

      {slow || low ? (
        <Note kind="warn">
          <b>개선이 필요합니다.</b>
          {slow ? ' 열람이 늦으면 요청자가 다른 곳과 먼저 이야기합니다.' : ''}
          {low ? ' 열람률이 낮으면 배정에서 뒤로 밀립니다.' : ''}
        </Note>
      ) : (
        <Note kind="ok"><b>지표가 안정적입니다.</b> 이 상태를 유지하시면 배정에서 유리합니다.</Note>
      )}

      <Note kind="info">
        <b>열람하지 않은 리드는 과금되지 않습니다.</b>{' '}
        다만 반복되면 배정이 줄어듭니다 — 받을 수 있는 만큼만 지역·업종을 열어 두시는 편이 낫습니다.
      </Note>
      <div className="pt-dact">
        <Link className="pt-bo" href="/partner/leads">상담 신청</Link>
        <Link className="pt-bo" href="/partner/performance">성과 관리</Link>
      </div>
    <i hidden data-root-end="" /></>
  );
}
