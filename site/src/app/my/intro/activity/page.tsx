import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note } from '@/components/my/ui';

export const metadata: Metadata = { title: '활동 내역' };

interface Card {
  registered?: boolean; note?: string;
  grade?: string; responses?: number; invitesSent?: number;
  invitesConsented?: number; validConnections?: number;
  consentRate?: string | number | null; avgRating?: string | number | null;
}
interface Points {
  earned: number; usable: number; note: string;
  rows: Array<{ id: number; name: string; points: number; redeemable: boolean; earnedAt: string }>;
}
/* v10.31 (시안 「8,500원」 · 10/10 시안 기준) — 포인트는 1포인트 = 1원, 「원」으로 적습니다(전: 「P」) */
const pt = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString('ko-KR')}원`;
interface Grade { code: string; name: string; criteria: string; benefit: string; nextHint: string | null; now: boolean }

/**
 * SB-MYP-INT-030
 *
 * 적립과 사용 가능을 나눠 보여 줍니다. 섞으면 "왜 못 쓰냐"는 문의가 그대로 옵니다.
 * v10.29 — 시안(scIntroAct) 배치: 오른쪽 위 「사용 가능」 → 숫자 4칸(제가 알아요 · 보낸 초대 · 동의 · 유효 연결 — /me/introducer/activity)
 *   → 적립 · 사용 가능 한 줄 → 안내 → 적립 내역 표 → 등급(현재 등급 · 수락률 · 평균 평가) → 다단계 아님 안내.
 *   v10.31 — 포인트 단위를 시안대로 「원」(1포인트 = 1원) · 시안의 등급 기준표(새싹 ~ 지역 파트너 · 기준 · 혜택 · 현재 표시)를
 *   GET /me/introducer/grades 로 그립니다. 개발의 수락률 · 평균 평가 줄은 표 아래 한 줄로 남깁니다.
 */
export default async function ActivityPage() {
  const p = await me();
  if (!p) redirect('/login');

  const [card, points, grades] = await Promise.all([
    apiGet<Card>('/me/introducer/activity', 0).catch(() => null),
    apiGet<Points>('/me/points', 0).catch(() => null),
    apiGet<Grade[]>('/me/introducer/grades', 0).catch(() => [] as Grade[]),
  ]);
  const reg = card && card.registered !== false;

  return (
    <><div data-intro-activity="">
      <MyHead title="활동 내역" sub="소개 활동과 적립 내역입니다. 포인트는 유효한 연결이 확인된 뒤에 사용할 수 있습니다."
        right={<span className="my-ls">사용 가능 {pt(points?.usable)}</span>} />

      {!reg && <Note kind="warn">{card?.note ?? '소개자 프로필을 먼저 등록해 주십시오.'}</Note>}
      <div className="my-stat4" data-intro-stat="">
        <div><span className="my-ls">제가 알아요</span><b>{card?.responses ?? 0}건</b></div>
        <div><span className="my-ls">보낸 초대</span><b>{card?.invitesSent ?? 0}건</b></div>
        <div><span className="my-ls">동의</span><b>{card?.invitesConsented ?? 0}건</b></div>
        <div><span className="my-ls">유효 연결</span><b>{card?.validConnections ?? 0}건</b></div>
      </div>

      <div className="my-subnow two">
        <div><span className="my-ls">적립</span><b className="big">{pt(points?.earned)}</b><span className="my-ls">활동으로 쌓인 전체</span></div>
        <div><span className="my-ls">사용 가능</span><b className="big">{pt(points?.usable)}</b><span className="my-ls">유효 연결이 확인된 분</span></div>
      </div>

      <Note kind="info"><b>프로필 작성이나 초대 발송만으로 받은 포인트는 바로 쓸 수 없습니다.</b> 실제 상담으로 이어진 것이 확인되면 그때 열립니다 — 가짜 계정을 막기 위해서입니다.</Note>

      <h2 className="my-s2">적립 내역</h2>
      {(points?.rows ?? []).length === 0 ? (
        <p className="my-ls">아직 적립 내역이 없습니다.</p>
      ) : (
        <div className="my-tbl-w">
          <table className="my-tbl">
            <thead><tr><th>활동</th><th>포인트</th><th>사용</th><th>날짜</th></tr></thead>
            <tbody>
              {(points?.rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="my-num">{pt(r.points)}</td>
                  <td><span className={`my-bg ${r.redeemable ? 'ok' : 'wait'}`}>{r.redeemable ? '가능' : '확인 대기'}</span></td>
                  <td className="my-ls">{ymdKst(r.earnedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="my-s2">등급</h2>
      <div className="my-tbl-w" data-intro-grades="">
        <table className="my-tbl">
          <thead><tr><th>등급</th><th>기준</th><th>혜택</th></tr></thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.code} className={g.now ? 'on' : undefined}>
                <td><b>{g.name}</b>{g.now && <> <span className="my-bg ok">현재</span></>}</td>
                <td className="my-ls">{g.criteria}</td>
                <td className="my-ls">{g.benefit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reg && <p className="my-ls" data-intro-rate="">수락률 {card?.consentRate != null ? `${card.consentRate}%` : '—'} · 평균 평가 {card?.avgRating ?? '—'}</p>}
      <Note kind="info"><b>등급은 보낸 건수가 아니라 수락률과 만족도로 정해집니다.</b> 아는 곳에만 보내시는 편이 등급에 낫습니다.</Note>

      <Note kind="warn">
        <b>회원을 데려오는 것으로는 수당이 없습니다.</b> 초대한 분이 첫 소개를 마치면 1회만 적립되고, 그분의 이후 활동으로는 아무것도 발생하지 않습니다 —
        다단계가 되지 않도록 구조로 막았습니다.
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
