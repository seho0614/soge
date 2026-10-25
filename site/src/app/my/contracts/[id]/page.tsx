import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import ContractForm, { type ContractState } from './ContractForm';
import { MyHead, Note, Empty, Table } from '@/components/my/ui';
import { dtKst, won, ymdKst } from '@/lib/format';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('ctrD.title') };
}

interface Hist {
  fromState: string | null; toState: string; memo: string | null;
  actor: string; createdAt: string;
}

/* v10.99 — 단계 · 상태 이름은 사전(myDeal.steps.* · myDeal.ctrD.state.*) */
const STEPS = ['talk', 'agree', 'sign', 'fulfil', 'done'] as const;
const STATES = ['DRAFT', 'SENT', 'COUNTER', 'AGREED', 'SIGNED', 'FULFILLED', 'CANCELLED'] as const;
const isState = (s: string): s is (typeof STATES)[number] => (STATES as readonly string[]).includes(s);

function stepOf(s: string) {
  if (s === 'DRAFT' || s === 'SENT' || s === 'COUNTER') return 0;
  if (s === 'AGREED') return 1;
  if (s === 'SIGNED') return 2;
  if (s === 'FULFILLED') return 4;
  return 0;
}

/**
 * SB-MYP-CTR-020 — 계약서 · 체결
 * v10.31 — 시안(scMyCtrD) 그대로 표준계약서 제1조 ~ 제8조:
 *   양식 · 상태 표 → 제1조 당사자(가입 정보 자동 기입 · 연락처 뒤 4자리 · 사업자번호 끝 3자리 가림 — 시안보다 가림을 유지)
 *   → 제2조 거래목적물(유형 물품 · 용역 · 금액 · 이행일 · 인도 장소 — 입력) → 제3조 소개비(소개비 · 지급 시점 · 소개코드 · 세금계산서)
 *   → 제4조 비당사자 → 제5 · 6조 성사 · 귀속 → 제7조 전자서명(누가 · 서명 · 시각) → 제8조 분쟁(관할법원 · 특약 — 입력)
 *   → 「서명 요청 보내기 · 양식 전문 보기 · 임시 저장」. 서버: GET /deals/{id}/contract/state(parties · fee · code · 서명 시각 · 임시 저장).
 *   개발의 단계 막대 · 진행 이력 · 서명하기 · 이행 확인 · 수정 요청은 그대로 둡니다(규칙 ③).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await me();
  const { id } = await params;
  if (!user) redirect(`/login?next=/my/contracts/${id}`);
  const t = await getTranslations('myDeal');
  const b_ = (c: React.ReactNode) => <b>{c}</b>;
  const br = () => <br />;

  const st = await apiGetPersonal<ContractState>(`/deals/${id}/contract/state`).catch(() => null);
  if (!st) {
    return (
      <><div data-ctr-none="">
        <MyHead title={t('ctrD.title')} sub={t('ctrD.sub')} />
        <Empty>{t('ctrD.none')}</Empty>
        <div className="my-btns"><Link className="my-bo" href="/my/contracts">{t('ctrD.toList')}</Link><Link className="my-bo" href="/contracts/templates/INTRO_STD">{t('ctrD.viewTpl')}</Link></div>
      </div><i hidden data-root-end="" /></>
    );
  }

  const hist = await apiGetPersonal<Hist[]>(`/deals/${id}/contract/history`).catch(() => [] as Hist[]);
  /* 완료된 계약은 보기만 됩니다. 서명하고 이행까지 끝난 것을 고칠 수 있으면 계약이 아닙니다. */
  const readOnly = st.state === 'FULFILLED' || st.state === 'CANCELLED';
  const cur = stepOf(st.state);
  const tpl = encodeURIComponent(st.templateCode ?? 'INTRO_STD');
  const b = st.parties?.buyer, s = st.parties?.seller;
  const signedN = Number(st.buyerSigned) + Number(st.sellerSigned);
  const me2 = st.mySide === 'BUYER' ? t('ctrD.buyerMe') : t('ctr.part.BUYER');
  const other = st.mySide === 'SELLER' ? t('ctrD.sellerMe') : t('ctr.part.SELLER');

  return (
    <><div data-ctr-detail={id}>
      <MyHead title={readOnly ? t('ctrD.titleDone') : t('ctrD.title')}
        sub={readOnly
          ? t('ctrD.subDone')
          : t.rich('ctrD.subRich', { b: b_ })}
        right={<Link className="my-bo" href={`/contracts/templates/${tpl}?deal=${encodeURIComponent(id)}`} data-ctform-link="">{t('ctrD.viewTpl')}</Link>} />

      <Note kind="warn">{t.rich('ctrD.warnFixed', { b: b_ })}</Note>

      <Table head={[t('ctrD.colItem'), t('ctrD.colContent')]}>
        <tr><td>{t('ctrD.rowTpl')}</td><td>{t('ctrD.tplName')} <span className="my-ls">{st.templateCode ?? 'INTRO_STD'}</span></td></tr>
        <tr><td>{t('ctrD.rowState')}</td><td><span className={`my-bg ${readOnly ? (st.state === 'FULFILLED' ? 'ok' : 'off') : 'wait'}`}>{isState(st.state) ? t(`ctrD.state.${st.state}`) : st.state}</span>{signedN === 1 && t('ctrD.oneSigned')}{st.stalled && !readOnly && t('ctrD.stalled')}</td></tr>
      </Table>

      <ol className="my-ctst" aria-label={t('ctr.stepsLabel')}>
        {STEPS.map((k, i) => (
          <li key={k} className={i === cur ? 'on' : i < cur ? 'done' : ''}><span className="my-n">{i + 1}</span><span className="my-t">{t(`steps.${k}`)}</span></li>
        ))}
      </ol>

      {/* ── 제1조 당사자 — 가입 정보가 자동으로 들어갑니다 ── */}
      <h2 className="my-st2">{t('ctrD.a1')}</h2>
      <Table head={[t('ctrD.colKind'), me2, other]}>
        <tr><td>{t('ctrD.company')}</td><td>{b?.company ?? '—'}</td><td>{s?.company ?? '—'}</td></tr>
        <tr><td>{t('ctrD.ceo')}</td><td>{b?.ceo ?? '—'}</td><td>{s?.ceo ?? '—'}</td></tr>
        <tr><td>{t('ctrD.bizNo')}</td><td>{b?.bizRegNo ?? '—'}</td><td>{s?.bizRegNo ?? '—'}</td></tr>
        <tr><td>{t('ctrD.phone')}</td><td>{b?.phone ?? '—'}</td><td>{s?.phone ?? '—'}</td></tr>
      </Table>
      <Note kind="info">{t.rich('ctrD.a1Note', { b: b_, br })}</Note>

      {/* 제2조 · 제8조 입력칸 · 서명 요청 보내기 · 임시 저장 · 서명 · 이행 확인 · 수정 요청 */}
      <ContractForm dealId={id} state={st} readOnly={readOnly}
        fee={<>
          {/* ── 제3조 소개비 ── */}
          <h2 className="my-st2">{t('ctrD.a3')}</h2>
          <Table head={[t('ctrD.colItem'), t('ctrD.colContent')]}>
            <tr><td>{t('ctrD.fee')}</td><td>{st.fee != null ? <><b>{won(st.fee)}</b> <span className="my-ls">{t('ctrD.feeAgreed')}</span></> : <span className="my-ls">{t('ctrD.feeNone')}</span>}</td></tr>
            <tr><td>{t('ctrD.payWhen')}</td><td>{t('ctrD.payWhenV')}</td></tr>
            <tr><td>{t('ctrD.code')}</td><td>{st.code ? <><span className="my-code">{st.code.code}</span>{st.code.issuedAt && <> · {t('ctrD.issued', { d: ymdKst(st.code.issuedAt) })}</>} · {t('ctrD.days90')}</> : <span className="my-ls">{t('ctrD.codeNone')}</span>}</td></tr>
            <tr><td>{t('ctrD.tax')}</td><td>{t('ctrD.taxV')}</td></tr>
          </Table>
          <Note kind="ok">{t.rich('ctrD.a3Note', { b: b_, br })}</Note>

          {/* ── 제4조 비당사자 ── */}
          <h2 className="my-st2">{t('ctrD.a4')}</h2>
          <Note kind="info">{t.rich('ctrD.a4Note', { b: b_, br })}</Note>

          {/* ── 제5 · 6조 ── */}
          <h2 className="my-st2">{t('ctrD.a56')}</h2>
          <Table head={[t('ctrD.colClause'), t('ctrD.colContent')]}>
            <tr><td>{t('ctrD.done')}</td><td>{t.rich('ctrD.doneV', { b: b_ })}</td></tr>
            <tr><td>{t('ctrD.attr')}</td><td>{t.rich('ctrD.attrV', { b: b_ })}</td></tr>
            <tr><td>{t('ctrD.dup')}</td><td>{t.rich('ctrD.dupV', { b: b_ })}</td></tr>
          </Table>

          {/* ── 제7조 전자서명 ── */}
          <h2 className="my-st2">{t('ctrD.a7')}</h2>
          <Table head={[t('ctrD.who'), t('ctrD.sign'), t('ctrD.time')]}>
            <tr><td>{me2} {b?.company}</td><td>{st.buyerSigned ? <span className="my-bg ok">{t('ctrD.signed')}</span> : <span className="my-bg wait">{t('ctrD.signWait')}</span>}</td><td>{st.buyerSignedAt ? dtKst(st.buyerSignedAt) : '—'}</td></tr>
            <tr><td>{other} {s?.company}</td><td>{st.sellerSigned ? <span className="my-bg ok">{t('ctrD.signed')}</span> : <span className="my-bg wait">{t('ctrD.signWait')}</span>}</td><td>{st.sellerSignedAt ? dtKst(st.sellerSignedAt) : '—'}</td></tr>
          </Table>
          <Note kind="info">{t.rich('ctrD.a7Note', { b: b_, br })}</Note>
          <Note kind="warn">{t.rich('ctrD.a7Warn', { b: b_ })}</Note>
        </>} />

      <h2 className="my-st2">{t('ctrD.history')}</h2>
      <p className="my-ls">{t('ctrD.histNote')}</p>
      {hist.length === 0 ? (
        <Empty>{t('ctrD.histEmpty')}</Empty>
      ) : (
        <Table head={[t('ctrD.time'), t('ctrD.who'), t('ctrD.what')]}>
          {hist.map((h, i) => (
            <tr key={i}>
              <td>{dtKst(h.createdAt)}</td>
              <td>{h.actor}</td>
              <td>{h.memo ?? `${h.fromState ?? ''} → ${h.toState}`}</td>
            </tr>
          ))}
        </Table>
      )}

      <Note kind="warn">{t.rich('ctrD.finalWarn', { b: b_ })}</Note>
      <div className="my-btns"><Link className="my-bo" href="/my/contracts">{t('ctrD.back')}</Link></div>
    </div><i hidden data-root-end="" /></>
  );
}
