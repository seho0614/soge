import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('act.title') };
}

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
  const t = await getTranslations('myDeal');
  const b_ = (c: React.ReactNode) => <b>{c}</b>;

  const [card, points, grades] = await Promise.all([
    apiGet<Card>('/me/introducer/activity', 0).catch(() => null),
    apiGet<Points>('/me/points', 0).catch(() => null),
    apiGet<Grade[]>('/me/introducer/grades', 0).catch(() => [] as Grade[]),
  ]);
  const reg = card && card.registered !== false;

  return (
    <><div data-intro-activity="">
      <MyHead title={t('act.title')} sub={t('act.sub')}
        right={<span className="my-ls">{t('act.usableN', { v: pt(points?.usable) })}</span>} />

      {!reg && <Note kind="warn">{card?.note ?? t('intro.needProfile')}</Note>}
      <div className="my-stat4" data-intro-stat="">
        <div><span className="my-ls">{t('answer.know')}</span><b>{t('intro.count', { n: String(card?.responses ?? 0) })}</b></div>
        <div><span className="my-ls">{t('act.sent')}</span><b>{t('intro.count', { n: String(card?.invitesSent ?? 0) })}</b></div>
        <div><span className="my-ls">{t('act.consented')}</span><b>{t('intro.count', { n: String(card?.invitesConsented ?? 0) })}</b></div>
        <div><span className="my-ls">{t('intro.valid')}</span><b>{t('intro.count', { n: String(card?.validConnections ?? 0) })}</b></div>
      </div>

      <div className="my-subnow two">
        <div><span className="my-ls">{t('act.earned')}</span><b className="big">{pt(points?.earned)}</b><span className="my-ls">{t('act.earnedDesc')}</span></div>
        <div><span className="my-ls">{t('act.usable')}</span><b className="big">{pt(points?.usable)}</b><span className="my-ls">{t('act.usableDesc')}</span></div>
      </div>

      <Note kind="info">{t.rich('act.pointNote', { b: b_ })}</Note>

      <h2 className="my-s2">{t('act.rowsH')}</h2>
      {(points?.rows ?? []).length === 0 ? (
        <p className="my-ls">{t('act.rowsEmpty')}</p>
      ) : (
        <div className="my-tbl-w">
          <table className="my-tbl">
            <thead><tr><th>{t('act.colAct')}</th><th>{t('act.colPt')}</th><th>{t('act.colUse')}</th><th>{t('act.colDate')}</th></tr></thead>
            <tbody>
              {(points?.rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="my-num">{pt(r.points)}</td>
                  <td><span className={`my-bg ${r.redeemable ? 'ok' : 'wait'}`}>{r.redeemable ? t('act.ok') : t('act.wait')}</span></td>
                  <td className="my-ls">{ymdKst(r.earnedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="my-s2">{t('intro.grade')}</h2>
      <div className="my-tbl-w" data-intro-grades="">
        <table className="my-tbl">
          <thead><tr><th>{t('intro.grade')}</th><th>{t('act.colCriteria')}</th><th>{t('act.colBenefit')}</th></tr></thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.code} className={g.now ? 'on' : undefined}>
                <td><b>{g.name}</b>{g.now && <> <span className="my-bg ok">{t('act.now')}</span></>}</td>
                <td className="my-ls">{g.criteria}</td>
                <td className="my-ls">{g.benefit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reg && <p className="my-ls" data-intro-rate="">{t('act.rateLine', { rate: card?.consentRate != null ? `${card.consentRate}%` : '—', avg: String(card?.avgRating ?? '—') })}</p>}
      <Note kind="info">{t.rich('act.gradeNote', { b: b_ })}</Note>

      <Note kind="warn">
        {t.rich('act.mlmNote', { b: b_ })}
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
