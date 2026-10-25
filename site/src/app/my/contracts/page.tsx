import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { won, ymdKst } from '@/lib/format';
import { MyHead, Tabs, Note, shortId, type Tone } from '@/components/my/ui';
import { NudgeButton } from '@/components/my/NudgeButton';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('ctr.title') };
}

interface Contract {
  dealId: string; contractId: string; listingId?: string | null; title: string; counterpart: string;
  state: string; stateLabel: string;
  buyerAgreed: boolean; sellerAgreed: boolean;
  buyerSigned: boolean; sellerSigned: boolean;
  fee: number | null; stalled: boolean; updatedAt: string; issuedAt?: string;
  /* v10.31 (시안 「나 ↔ 상대」 · 계약번호 · 소개코드 · 다음 할 일 · 확인 요청) */
  myPart?: 'BUYER' | 'SELLER'; attributedCode?: string | null;
  mine?: string; theirs?: string; nextAction?: string; canNudge?: boolean; nudgedAt?: string | null;
}

/* v10.99 — 탭 · 단계 이름은 사전(myDeal.ctr.tabs.* · myDeal.steps.*) */
const TABS = [{ k: 'all' }, { k: 'req' }, { k: 'run' }, { k: 'done' }, { k: 'hold' }] as const;
const STEPS = ['talk', 'agree', 'sign', 'fulfil', 'done'] as const;

/** 상태를 탭으로 묶습니다. 이용자는 코드가 아니라 "지금 뭘 해야 하나"로 봅니다. */
function tabOf(s: string) {
  if (s === 'DRAFT' || s === 'SENT') return 'req';
  if (s === 'AGREED' || s === 'SIGNED') return 'run';
  if (s === 'FULFILLED') return 'done';
  return 'hold';                       // COUNTER · CANCELLED
}
/** 계약서 화면(/my/contracts/[id])의 단계와 같은 규칙 */
function stepOf(s: string) {
  if (s === 'AGREED') return 1;
  if (s === 'SIGNED') return 2;
  if (s === 'FULFILLED') return 4;
  return 0;
}
const TONE: Record<string, Tone> = { req: 'wait', run: 'wait', done: 'ok', hold: 'no' };
const side = (agreed: boolean, signed: boolean) => (signed ? 'signed' : agreed ? 'agreed' : 'review') as 'signed' | 'agreed' | 'review';

/**
 * SB-MYP-CTR-010 — 계약 진행 목록
 * v10.29 — 시안(scMyCtr) 배치: 상태 탭(건수) → 계약 카드(제목 · 번호 · 날짜 · 상태 배지 | 5단계 막대 | 양측 상태 ↔ | 단추 | 소개비 안내).
 *   v10.31 — 시안 그대로 「나 ↔ 상대」(서버 mine · theirs · myPart) · 계약번호 · 소개코드 · 다음 할 일 문구(nextAction) · 「확인 요청」 단추.
 *   완료된 계약은 시안처럼 「계약서 보기 · 수정 불가」.
 */
export default async function Page({ searchParams }:
  { searchParams: Promise<{ tab?: string }> }) {
  const user = await me();
  if (!user) redirect('/login?next=/my/contracts');
  const t = await getTranslations('myDeal');

  const { tab: t0 = 'all' } = await searchParams;
  const tab = TABS.some((x) => x.k === t0) ? t0 : 'all';
  const list = await apiGetPersonal<Contract[]>('/me/contracts').catch(() => [] as Contract[]);
  const rows = list.filter(c => tab === 'all' || tabOf(c.state) === tab);

  return (
    <>
      <MyHead title={t('ctr.title')} sub={t('ctr.sub')} />

      <Tabs label={t('ctr.tabsLabel')} cur={tab} items={TABS.map((x) => ({
        k: x.k, t: t(`ctr.tabs.${x.k}`), href: `/my/contracts?tab=${x.k}`,
        n: x.k === 'all' ? list.length : list.filter(c => tabOf(c.state) === x.k).length,
      }))} />

      {rows.length === 0 ? (
        <Note kind="info">{t('ctr.empty')}</Note>
      ) : (
        <div data-ctr-list="">
          {rows.map(c => {
            const cur = stepOf(c.state);
            const ro = c.state === 'FULFILLED';
            return (
              <div key={c.contractId} className={`my-ctr${ro ? ' ro' : ''}`} data-ctr={c.contractId}>
                <div className="my-ctrh">
                  <div>
                    <b>{c.title}</b>
                    <span className="my-ls">{shortId(c.contractId, 'C-')}{c.attributedCode && <> · <span className="my-code">{c.attributedCode}</span></>} · {ymdKst(c.issuedAt ?? c.updatedAt)}</span>
                  </div>
                  <span>
                    {/* 3일 넘게 멈춘 건은 눈에 띄어야 합니다 — 한쪽이 잊은 경우가 많습니다. */}
                    {c.stalled && <span className="my-bg no" style={{ marginRight: 6 }}>{t('ctr.stalled')}</span>}
                    <span className={`my-bg ${TONE[tabOf(c.state)]}`}>{c.stateLabel}</span>
                  </span>
                </div>
                <ol className="my-ctst" aria-label={t('ctr.stepsLabel')}>
                  {STEPS.map((k, i) => (
                    <li key={k} className={i === cur ? 'on' : i < cur ? 'done' : ''}><span className="my-n">{i + 1}</span><span className="my-t">{t(`steps.${k}`)}</span></li>
                  ))}
                </ol>
                {/* 양측 상태를 나란히. 한쪽만 보이면 "왜 안 되지"가 됩니다. */}
                <div className="my-ctrp" data-ctr-sides="">
                  {c.mine != null ? (
                    <>
                      <div className="my-cp"><span className="my-ls">{t('ctr.me')}{c.myPart ? ` · ${t(`ctr.part.${c.myPart}`)}` : ''}</span><b>{c.mine}</b></div>
                      <div className="my-cpx">↔</div>
                      <div className="my-cp"><span className="my-ls">{c.counterpart}</span><b>{c.theirs}</b></div>
                    </>
                  ) : (
                    <>
                      <div className="my-cp"><span className="my-ls">{t('ctr.part.BUYER')}</span><b>{t(`ctr.side.${side(c.buyerAgreed, c.buyerSigned)}`)}</b></div>
                      <div className="my-cpx">↔</div>
                      <div className="my-cp"><span className="my-ls">{t('ctr.part.SELLER')}</span><b>{t(`ctr.side.${side(c.sellerAgreed, c.sellerSigned)}`)}</b></div>
                    </>
                  )}
                </div>
                {c.nextAction && <div className="my-ctrn" data-ctr-next="">{c.nextAction}</div>}
                <div className="my-ctra">
                  <Link className="my-bp" href={`/my/contracts/${c.dealId}`}>
                    {ro ? t('ctr.btnView') : c.state === 'DRAFT' || tabOf(c.state) === 'req' ? t('ctr.btnWrite') : t('ctr.btnRun')}
                  </Link>
                  {ro ? (
                    <button type="button" className="my-bo" disabled title={t('ctr.noEditTitle')}>{t('ctr.noEdit')}</button>
                  ) : (
                    <>
                      {/* 20260930 — /chat/[id] 는 **매물 id** 를 받습니다. 요청 기반 거래(매물 없음)는 계약 화면에서 조율합니다. */}
                      {c.listingId && <Link className="my-bo" href={`/chat/${c.listingId}`}>{t('ctr.chat')}</Link>}
                      {c.state !== 'CANCELLED' && <NudgeButton dealId={c.dealId} disabled={c.canNudge === false}
                        title={c.canNudge === false ? (c.nudgedAt ? t('ctr.nudgeSent') : t('ctr.nudgeYourTurn')) : t('ctr.nudgeSend')} />}
                    </>
                  )}
                </div>
                <div className="my-nt3">{t.rich('ctr.feeNote', { fee: c.fee != null ? won(c.fee) : t('ctr.feeTbd'), b: (x) => <b>{x}</b> })}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
