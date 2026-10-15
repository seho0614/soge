import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import ContractForm, { type ContractState } from './ContractForm';
import { MyHead, Note, Empty, Table } from '@/components/my/ui';
import { dtKst, won, ymdKst } from '@/lib/format';

export const metadata: Metadata = { title: '계약서 · 체결' };

interface Hist {
  fromState: string | null; toState: string; memo: string | null;
  actor: string; createdAt: string;
}

const STEPS = ['조건 협의', '양측 합의', '양측 서명', '이행 확인', '성사'];
const STATE_LABEL: Record<string, string> = {
  DRAFT: '작성 중', SENT: '상대 확인 대기', COUNTER: '수정 요청됨', AGREED: '서명 대기', SIGNED: '이행 대기', FULFILLED: '계약 완료', CANCELLED: '파기',
};

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

  const st = await apiGetPersonal<ContractState>(`/deals/${id}/contract/state`).catch(() => null);
  if (!st) {
    return (
      <><div data-ctr-none="">
        <MyHead title="계약서 · 체결" sub="표준계약서 제1조~제8조. 조항은 고칠 수 없고 빈칸만 채웁니다." />
        <Empty>계약이 없습니다. 1:1 대화에서 계약서를 먼저 요청하십시오.</Empty>
        <div className="my-btns"><Link className="my-bo" href="/my/contracts">계약 목록으로</Link><Link className="my-bo" href="/contracts/templates/INTRO_STD">양식 전문 보기</Link></div>
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
  const me2 = st.mySide === 'BUYER' ? '구매 쪽(나)' : '구매 쪽';
  const other = st.mySide === 'SELLER' ? '판매 쪽(나)' : '판매 쪽';

  return (
    <><div data-ctr-detail={id}>
      <MyHead title={readOnly ? '계약 내용 (완료)' : '계약서 · 체결'}
        sub={readOnly
          ? '완료된 계약입니다. 보기만 가능하며 고칠 수 없습니다 — 바꾸시려면 파기하고 다시 맺으십시오.'
          : <>표준계약서 제1조~제8조. <b>조항은 고칠 수 없고 빈칸만 채웁니다.</b></>}
        right={<Link className="my-bo" href={`/contracts/templates/${tpl}?deal=${encodeURIComponent(id)}`} data-ctform-link="">양식 전문 보기</Link>} />

      <Note kind="warn"><b>이 양식은 조항을 고칠 수 없습니다.</b> 아래 빈칸만 채우십시오 — 조항을 개별 수정하면 저희가 법률사무를 취급한 것이 되어 <b>변호사법 109조</b>에 걸립니다.</Note>

      <Table head={['항목', '내용']}>
        <tr><td>양식</td><td>소개 표준계약서 <span className="my-ls">{st.templateCode ?? 'INTRO_STD'}</span></td></tr>
        <tr><td>상태</td><td><span className={`my-bg ${readOnly ? (st.state === 'FULFILLED' ? 'ok' : 'off') : 'wait'}`}>{STATE_LABEL[st.state] ?? st.state}</span>{signedN === 1 && ' · 한쪽 서명 완료'}{st.stalled && !readOnly && ' · 3일 넘게 멈춤'}</td></tr>
      </Table>

      <ol className="my-ctst" aria-label="계약 단계">
        {STEPS.map((t, i) => (
          <li key={t} className={i === cur ? 'on' : i < cur ? 'done' : ''}><span className="my-n">{i + 1}</span><span className="my-t">{t}</span></li>
        ))}
      </ol>

      {/* ── 제1조 당사자 — 가입 정보가 자동으로 들어갑니다 ── */}
      <h2 className="my-st2">제1조 (당사자)</h2>
      <Table head={['구분', me2, other]}>
        <tr><td>상호</td><td>{b?.company ?? '—'}</td><td>{s?.company ?? '—'}</td></tr>
        <tr><td>대표자</td><td>{b?.ceo ?? '—'}</td><td>{s?.ceo ?? '—'}</td></tr>
        <tr><td>사업자등록번호</td><td>{b?.bizRegNo ?? '—'}</td><td>{s?.bizRegNo ?? '—'}</td></tr>
        <tr><td>연락처</td><td>{b?.phone ?? '—'}</td><td>{s?.phone ?? '—'}</td></tr>
      </Table>
      <Note kind="info"><b>가입 때 등록하신 정보가 자동으로 들어갑니다.</b> 계약서에서는 고치실 수 없습니다 — 바꾸시려면 회원 정보를 고치고 다시 발급하십시오.<br />
        사업자 정보는 사업자 인증을 마친 경우에만 들어갑니다. 연락처는 뒤 4자리만, 사업자등록번호는 끝 3자리를 가려 보입니다.</Note>

      {/* 제2조 · 제8조 입력칸 · 서명 요청 보내기 · 임시 저장 · 서명 · 이행 확인 · 수정 요청 */}
      <ContractForm dealId={id} state={st} readOnly={readOnly}
        fee={<>
          {/* ── 제3조 소개비 ── */}
          <h2 className="my-st2">제3조 (소개비)</h2>
          <Table head={['항목', '내용']}>
            <tr><td>소개비</td><td>{st.fee != null ? <><b>{won(st.fee)}</b> <span className="my-ls">당사자 협의</span></> : <span className="my-ls">소개비 약정 없음</span>}</td></tr>
            <tr><td>지급 시점</td><td>성사 확정 후 — 당사자끼리 직접 지급</td></tr>
            <tr><td>소개코드</td><td>{st.code ? <><span className="my-code">{st.code.code}</span>{st.code.issuedAt && <> · 발급 {ymdKst(st.code.issuedAt)}</>} · 90일</> : <span className="my-ls">귀속된 소개코드 없음</span>}</td></tr>
            <tr><td>세금계산서</td><td>소개자가 직접 발행</td></tr>
          </Table>
          <Note kind="ok"><b>소개비는 요율표가 아니라 당사자 협의로 정합니다(A-12).</b><br /><b>당사자끼리 직접</b> 주고받으십시오 — 소개뱅크 계좌로 보내지 마십시오. 저희는 여기서 한 푼도 떼지 않습니다(INV-9 · INV-11).</Note>

          {/* ── 제4조 비당사자 ── */}
          <h2 className="my-st2">제4조 (소개뱅크는 이 계약의 당사자가 아닙니다)</h2>
          <Note kind="info"><b>이 조항은 고칠 수 없습니다.</b><br /><br />
            ① 이 계약은 <b>당사자 사이의 계약</b>입니다. 소개뱅크는 이 계약의 당사자가 아닙니다.<br />
            ② 소개뱅크는 계약 내용의 이행·불이행에 대하여 책임지지 않습니다.<br />
            ③ 소개뱅크가 하는 일은 양측이 서로를 찾도록 잇고, 그 기록을 남기는 것입니다.</Note>

          {/* ── 제5 · 6조 ── */}
          <h2 className="my-st2">제5조 (성사) · 제6조 (소개 귀속)</h2>
          <Table head={['조항', '내용']}>
            <tr><td>성사 확정</td><td><b>양측이 각각 확인</b>한 때 — 한쪽만 눌러서는 안 됩니다</td></tr>
            <tr><td>소개 귀속</td><td>첫 접촉일부터 <b>90일</b></td></tr>
            <tr><td>중복 소개</td><td><b>먼저 접촉한</b> 소개자에게 귀속</td></tr>
          </Table>

          {/* ── 제7조 전자서명 ── */}
          <h2 className="my-st2">제7조 (전자서명)</h2>
          <Table head={['누가', '서명', '시각']}>
            <tr><td>{me2} {b?.company}</td><td>{st.buyerSigned ? <span className="my-bg ok">서명 완료</span> : <span className="my-bg wait">서명 대기</span>}</td><td>{st.buyerSignedAt ? dtKst(st.buyerSignedAt) : '—'}</td></tr>
            <tr><td>{other} {s?.company}</td><td>{st.sellerSigned ? <span className="my-bg ok">서명 완료</span> : <span className="my-bg wait">서명 대기</span>}</td><td>{st.sellerSignedAt ? dtKst(st.sellerSignedAt) : '—'}</td></tr>
          </Table>
          <Note kind="info"><b>서명은 외부 전자계약 서비스가 합니다.</b> 이메일·휴대폰으로 본인을 확인하고, <b>서명 시각을 그쪽이 증명</b>합니다 — 저희가 직접 찍으면 저희가 만든 기록이라 분쟁에서 약합니다.<br />원본은 그 서비스가 보관하고, 저희에게는 <b>체결 상태와 링크만</b> 남습니다.</Note>
          <Note kind="warn"><b>연동 전이라 실제 서명 요청이 나가지 않습니다.</b> 지금 보이는 것은 흐름 확인용이며 <b>법적 효력이 없습니다.</b></Note>
        </>} />

      <h2 className="my-st2">진행 이력</h2>
      <p className="my-ls">분쟁에서 &ldquo;누가 언제 무엇을 했는가&rdquo;의 근거입니다. 지워지지 않습니다.</p>
      {hist.length === 0 ? (
        <Empty>아직 기록이 없습니다.</Empty>
      ) : (
        <Table head={['시각', '누가', '무엇을']}>
          {hist.map((h, i) => (
            <tr key={i}>
              <td>{dtKst(h.createdAt)}</td>
              <td>{h.actor}</td>
              <td>{h.memo ?? `${h.fromState ?? ''} → ${h.toState}`}</td>
            </tr>
          ))}
        </Table>
      )}

      <Note kind="warn"><b>서명 후에는 조건을 바꿀 수 없습니다.</b> 바꾸시려면 해지하고 다시 체결하십시오.</Note>
      <div className="my-btns"><Link className="my-bo" href="/my/contracts">← 계약 진행</Link></div>
    </div><i hidden data-root-end="" /></>
  );
}
