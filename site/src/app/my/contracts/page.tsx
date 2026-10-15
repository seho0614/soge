import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { won, ymdKst } from '@/lib/format';
import { MyHead, Tabs, Note, shortId, type Tone } from '@/components/my/ui';
import { NudgeButton } from '@/components/my/NudgeButton';

export const metadata: Metadata = { title: '계약 진행' };

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

const TABS = [
  { k: 'all',  t: '전체' },
  { k: 'req',  t: '계약 요청' },
  { k: 'run',  t: '계약 진행' },
  { k: 'done', t: '계약 완료' },
  { k: 'hold', t: '계약 보류' },
];
const STEPS = ['조건 협의', '양측 합의', '양측 서명', '이행 확인', '성사'];

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
const side = (agreed: boolean, signed: boolean) => (signed ? '서명 완료' : agreed ? '합의 완료' : '검토 중');
const PART: Record<string, string> = { BUYER: '구매 쪽', SELLER: '판매 쪽' };

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

  const { tab: t0 = 'all' } = await searchParams;
  const tab = TABS.some((x) => x.k === t0) ? t0 : 'all';
  const list = await apiGetPersonal<Contract[]>('/me/contracts').catch(() => [] as Contract[]);
  const rows = list.filter(c => tab === 'all' || tabOf(c.state) === tab);

  return (
    <>
      <MyHead title="계약 진행" sub="당사자끼리 맺고 계신 계약입니다. 소개뱅크는 양식만 제공하며 계약 당사자가 아닙니다 — 조건과 이행 책임은 당사자에게 있습니다." />

      <Tabs label="계약 상태" cur={tab} items={TABS.map((x) => ({
        k: x.k, t: x.t, href: `/my/contracts?tab=${x.k}`,
        n: x.k === 'all' ? list.length : list.filter(c => tabOf(c.state) === x.k).length,
      }))} />

      {rows.length === 0 ? (
        <Note kind="info">이 상태의 계약이 없습니다. 1:1 대화에서 조건을 맞춘 뒤 「계약서 요청하기」로 시작합니다.</Note>
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
                    {c.stalled && <span className="my-bg no" style={{ marginRight: 6 }}>3일째 대기</span>}
                    <span className={`my-bg ${TONE[tabOf(c.state)]}`}>{c.stateLabel}</span>
                  </span>
                </div>
                <ol className="my-ctst" aria-label="계약 단계">
                  {STEPS.map((t, i) => (
                    <li key={t} className={i === cur ? 'on' : i < cur ? 'done' : ''}><span className="my-n">{i + 1}</span><span className="my-t">{t}</span></li>
                  ))}
                </ol>
                {/* 양측 상태를 나란히. 한쪽만 보이면 "왜 안 되지"가 됩니다. */}
                <div className="my-ctrp" data-ctr-sides="">
                  {c.mine != null ? (
                    <>
                      <div className="my-cp"><span className="my-ls">나{c.myPart ? ` · ${PART[c.myPart]}` : ''}</span><b>{c.mine}</b></div>
                      <div className="my-cpx">↔</div>
                      <div className="my-cp"><span className="my-ls">{c.counterpart}</span><b>{c.theirs}</b></div>
                    </>
                  ) : (
                    <>
                      <div className="my-cp"><span className="my-ls">구매 쪽</span><b>{side(c.buyerAgreed, c.buyerSigned)}</b></div>
                      <div className="my-cpx">↔</div>
                      <div className="my-cp"><span className="my-ls">판매 쪽</span><b>{side(c.sellerAgreed, c.sellerSigned)}</b></div>
                    </>
                  )}
                </div>
                {c.nextAction && <div className="my-ctrn" data-ctr-next="">{c.nextAction}</div>}
                <div className="my-ctra">
                  <Link className="my-bp" href={`/my/contracts/${c.dealId}`}>
                    {ro ? '계약서 보기' : c.state === 'DRAFT' || tabOf(c.state) === 'req' ? '계약서 작성 ›' : '계약 진행 ›'}
                  </Link>
                  {ro ? (
                    <button type="button" className="my-bo" disabled title="완료된 계약은 고칠 수 없습니다. 바꾸시려면 파기하고 다시 맺으십시오.">수정 불가</button>
                  ) : (
                    <>
                      {/* 20260930 — /chat/[id] 는 **매물 id** 를 받습니다. 요청 기반 거래(매물 없음)는 계약 화면에서 조율합니다. */}
                      {c.listingId && <Link className="my-bo" href={`/chat/${c.listingId}`}>대화로 조율</Link>}
                      {c.state !== 'CANCELLED' && <NudgeButton dealId={c.dealId} disabled={c.canNudge === false}
                        title={c.canNudge === false ? (c.nudgedAt ? '오늘 이미 확인 요청을 보냈습니다.' : '지금은 회원님 차례입니다.') : '상대방에게 확인 요청 알림을 보냅니다.'} />}
                    </>
                  )}
                </div>
                <div className="my-nt3">소개비 {c.fee != null ? won(c.fee) : '(확정 전)'}은 <b>성사가 확정된 뒤</b> 소개자에게 지급됩니다. 대금은 당사자끼리 직접 주고받으시고, 플랫폼은 보관하지 않습니다.</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
