import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ymdKst } from '../../lib/format';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { useHashSub } from '../../lib/hashSub';
import { LeadAssign } from './LeadAssign';
/** v10.38 (D096 · P2P) — 개인 파트너(개인 활동 정보)는 사업자등록번호가 없습니다 */
const bizNo = (v?: string | null) => (v ? `사업자 ${v}` : '개인(본인인증)');
import { CashWallets, CashInvoices, CashRules, ChangeRequests } from './PartnerCash';

interface Partner {
  id: string; company: string; bizRegNo: string | null;
  grade: string; status: string;
  services: number | string; unpaid: number | string; unpaidCap: number | string;
  appliedAt?: string; bizVerified?: boolean; personal?: boolean; actorOk?: boolean; rejectReason?: string | null;
}
interface PendingService {
  id: string; title: string; body: string | null; submittedAt: string;
  partnerId: string; partnerStatus: string; grade: string; company: string; bizRegNo: string | null;
  categoryName: string | null; gwanCode: string | null; restrictedCode: string | null;
  leadFee: string | null; qualCode: string | null; qualState: string | null;
  rejectedBefore: number; approvedBefore: number;
}
interface VoidRequest {
  id: number; feeId: number; state: string; reasonCode: string; reason: string; evidence: string | null;
  requestedAt: string; ruleCode: string | null; decisionReason: string | null; decidedAt: string | null;
  decidedBy: string | null; amount: string; feeState: string; deliveredAt: string; viewedAt: string | null;
  summary: string; sido: string | null; sigungu: string | null; categoryName: string | null;
  partnerId: string; company: string; grade: string; monthReceived: number; monthRequested: number;
}
interface VoidList { items: VoidRequest[]; rules: Array<{ code: string; name: string }> }
interface FeeRow {
  partnerId: string; company: string; grade: string;
  unpaid: number | string; unpaidCap: number | string; voided: number | string;
}

const STATUS: Record<string, string> = {
  APPLIED: '심사 대기', ACTIVE: '활동', SUSPENDED: '중지', WITHDRAWN: '탈퇴', REJECTED: '반려',
};

type View = 'list' | 'apply' | 'services' | 'leads' | 'rejects' | 'wallet' | 'detail';
/* v10.31 (10/10 시안 기준) — 시안 하위 탭 줄 그대로(파트너사 목록 · 입점 신청 · 서비스 검수 · 의료 심의 · 리드 반려 · 리드 배정 · 카테고리 마스터 · 자격 심사 · 리드 이용료 · 정산).
 * 의료 심의 · 카테고리 마스터 · 자격 심사는 같은 API 를 쓰는 「인증 심사 › 자격 심사」 화면에 있어 그 하위 탭으로 바로 보냅니다(두 곳에 두지 않음). */
type Tab2 = View | 'medical' | 'cats' | 'quals';
const TABS: SubTab<Tab2>[] = [
  { key: 'list', label: '파트너사 목록', screen: 'SB-ADM-PTN-010' },
  { key: 'apply', label: '입점 신청', screen: 'SB-ADM-PTN-020' },
  { key: 'services', label: '서비스 검수', screen: 'SB-ADM-PTN-030' },
  { key: 'medical', label: '의료 심의', screen: 'SB-ADM-PTN-040', out: true },
  { key: 'rejects', label: '리드 반려', screen: 'SB-ADM-PTN-050' },
  { key: 'leads', label: '리드 배정', screen: 'SB-ADM-PTN-090' },
  { key: 'cats', label: '카테고리 마스터', screen: 'SB-ADM-PTN-060', out: true },
  { key: 'quals', label: '자격 심사', screen: 'SB-ADM-PTN-070', out: true },
  { key: 'wallet', label: '리드 이용료 · 정산', screen: 'SB-ADM-PTN-080' },
];
const OUT: Record<string, string> = { medical: 'quals/medical', cats: 'quals/cats', quals: 'quals/pending' };

/**
 * SB-ADM-PTN-010 파트너사 목록
 * SB-ADM-PTN-020 입점 신청 승인 (T-01)
 * SB-ADM-PTN-030 서비스 검수 승인 (T-02)
 * SB-ADM-PTN-090 리드 배정 (D008) — LeadAssign.tsx
 * SB-ADM-PTN-050 리드 반려 인정 / 기각 (T-04)
 * SB-ADM-PTN-080 소개캐시 입금 확인 · 리드 등급 비율
 *
 * 파트너가 리드를 못 받는 이유는 넷입니다 — 승인 · 서비스 · 지역 · 미납.
 * 여기서 앞의 둘을 풉니다. 미납은 자동으로 멈추고 자동으로 풀립니다.
 *
 * 카테고리 마스터(T-05 · T-06, SB-ADM-PTN-060)와 규제 자격 심사(T-21, SB-ADM-PTN-070)는
 * 같은 API 를 쓰는 "자격 심사" 탭에 있습니다 — 두 곳에 두지 않습니다.
 */
export function Partners({ onGo }: { onGo?: (tab: string) => void }) {
  const [view, setView] = useHashSub<View>('list', ['list', 'apply', 'services', 'leads', 'rejects', 'wallet', 'detail']);
  const pick = (k: Tab2) => { if (OUT[k]) { if (onGo) onGo(OUT[k]!); } else setView(k as View); };
  const tabs = TABS.filter((t) => !OUT[t.key] || onGo);
  /* v10.32 — SB-ADM-PTN-011 파트너사 상세는 목록 안에 펼치지 않고 자기 주소(#/partners/detail/<id>)로 따로 엽니다(시안 admptnd) */
  const openDetail = (id: string) => {
    history.pushState(null, '', `#/partners/detail/${id}`);
    window.dispatchEvent(new Event('bo-sub'));
    window.scrollTo(0, 0);
  };
  const detailId = view === 'detail' ? (location.hash.replace(/^#\/?/, '').split('/')[2] ?? '') : '';
  return (
    <section>
      <SubTabs tabs={tabs} value={view === 'detail' ? 'list' : view} onChange={pick} />
      {view === 'list' && <PartnerList onGo={(v) => pick(v as Tab2)} onOpen={openDetail} />}
      {view === 'detail' && (/^[0-9a-f-]{36}$/i.test(detailId)
        ? <PartnerDetail key={detailId} id={detailId} onClose={() => setView('list')} onGo={(v) => pick(v)} />
        : <><p className="ad-empty">고른 파트너사가 없습니다 — 목록에서 「상세」를 누르십시오.</p>
            <div className="ad-dact"><button className="btn-plain" data-ptn-close="" onClick={() => setView('list')}>← 파트너사 목록</button></div></>)}
      {view === 'apply' && <Apply />}
      {view === 'services' && <Services />}
      {view === 'leads' && <LeadAssign />}
      {view === 'rejects' && <Rejects />}
      {view === 'wallet' && <Wallet onGo={onGo} />}
    </section>
  );
}

/* ── SB-ADM-PTN-010 목록 ─────────────────────────────────────────── */
/* v10.32 — 시안 표 칸(ID · 막힌 업무 · 현재 상태 · 관련 화면 · 열기). 관련 화면은 그 일을 처리하는 운영 화면 ID */
const BLOCKED: Array<[string, string, string, Tab2, string]> = [
  ['T-01', '입점 신청 승인', '신청은 pending 으로 저장되나 승인 처리 수단이 없었습니다 — 이제 입점 신청에서 처리합니다', 'apply', 'PTN-020'],
  ['T-02', '서비스 검수 승인', '검수중 → 노출중 전환이 불가능했습니다 — 이제 서비스 검수에서 처리합니다', 'services', 'PTN-030'],
  ['T-03', '의료 심의 본사 확인', '심의필 등록 후 본사 확인에서 멈췄습니다 — 이제 의료 심의에서 처리합니다', 'medical', 'PTN-040'],
  ['T-04', '리드 반려 인정/기각', '파트너 반려 신청을 받는 자리가 없었습니다 — 이제 신청 목록에서 처리합니다', 'rejects', 'PTN-050'],
  ['T-05', '카테고리 단가 폼 축', '폼 유형 미지정 카테고리는 단가 입력이 막힙니다', 'cats', 'PTN-060'],
  ['T-06', '매트릭스 축 마스터', '견적 축이 데이터(category_matrix_axes)로 옮겨졌습니다', 'cats', 'PTN-060'],
  ['T-21', '규제 카테고리 자격 심사', '자격 제출 후 심사중에서 대기합니다', 'quals', 'PTN-070'],
];

interface PartnerDetailRes extends Omit<Partner, 'services'> {
  ceoName: string | null; ntsStatus: string | null; approvedAt: string | null; suspendedReason: string | null; stopped: boolean;
  services: Array<{ id: string; title: string; category: string; gwanCode: string; status: string; rejectReason: string | null; createdAt: string }>;
  regions: Array<{ sido: string; sigungu: string | null }>;
  fees: Array<{ state: string; count: number; amount: number }>;
}
const FEE_STATE: Record<string, string> = { PENDING: '미청구', BILLED: '청구됨', PAID: '결제됨', VOID: '무효' };

/* v10.32 — GET /admin/partners/cards (시안 카드 줄의 칸) · GET /admin/partners/:id/docs (상세 「계약 · 서류」) — 둘 다 읽기 전용 */
interface PartnerCard { id: string; leads: number; cash: number; category: string | null; form: string | null; formLabel: string | null; qualPending: boolean; qualName: string | null }
interface PartnerDocs {
  status: string;
  terms: Array<{ code: string; version: string; title: string; agreedAt: string | null }>;
  nts: { status: string | null; checkedAt: string | null; env: string | null; verifiedAt: string | null };
  qualifications: Array<{ code: string; name: string; state: string; decidedAt: string | null }>;
}
const PST: Record<string, [string, string]> = {
  ACTIVE: ['ok', '운영중'], APPLIED: ['wait', '입점 심사중'], SUSPENDED: ['no', '중지'], WITHDRAWN: ['', '탈퇴'], REJECTED: ['no', '반려'],
};
const NTS: Record<string, string> = { VALID: '계속사업자', CLOSED: '폐업', SUSPENDED: '휴업', UNKNOWN: '조회 불가' };
const ymd = (s?: string | null) => (s ? ymdKst(s) : '—');
function partnerWarn(p: Partner, c?: PartnerCard): string | null {
  if (p.status === 'APPLIED') return '입점 심사 대기 — 승인 전에는 리드가 가지 않습니다';
  if (p.status === 'REJECTED') return `입점 반려${p.rejectReason ? ` — ${p.rejectReason}` : ''}`;
  if (p.status === 'SUSPENDED') return '중지 — 리드 수신이 멈췄습니다';
  if (Number(p.unpaid) >= Number(p.unpaidCap)) return `리드 이용료 미청구 ${n(p.unpaid)}원 — 한도 ${n(p.unpaidCap)}원에 닿아 리드 수신이 막힙니다`;
  if (c?.qualPending) return `${c.qualName ?? '규제 업종'} · 자격 심사 대기(T-21)`;
  return null;
}

/* ── SB-ADM-PTN-011 파트너사 상세 · v10.27 (G-130) — 목록의 「상세」가 엽니다 ─────────── */
/* v10.32 — 시안(scAdmPtnD) 배치: 업체 머리 → (경고) → 숫자 4칸 → 계약 · 서류 → 서비스 → 처리 바로가기. 따로 열리는 화면(#/partners/detail/<id>) */
function PartnerDetail({ id, onClose, onGo }: { id: string; onClose: () => void; onGo: (v: Tab2) => void }) {
  const d = useApi<PartnerDetailRes>(`/admin/partners/${id}`);
  const docs = useApi<PartnerDocs>(`/admin/partners/${id}/docs`);
  const cards = useApi<PartnerCard[]>('/admin/partners/cards');
  if (d.error) return <ErrorView error={d.error} onRetry={d.reload} />;
  if (!d.data) return <p className="muted">불러오는 중…</p>;
  const p = d.data;
  const c = (cards.data ?? []).find((x) => x.id === p.id);
  const [stc, stl] = PST[p.status] ?? ['', p.status];
  const warn = partnerWarn({ ...p, services: p.services.length }, c);
  const leads = c ? c.leads : p.fees.reduce((a, f) => a + Number(f.count || 0), 0);
  const SVC: Record<string, [string, string]> = { APPROVED: ['ok', '노출'], ACTIVE: ['ok', '노출'], PUBLISHED: ['ok', '노출'], IN_REVIEW: ['wait', '검수 중'], REJECTED: ['no', '반려'], DRAFT: ['', '작성 중'] };
  const docRows: Array<[string, JSX.Element, string]> = docs.data ? [
    ...docs.data.terms.map((t): [string, JSX.Element, string] => [`${t.title} ${t.version}`,
      t.agreedAt ? <span className="ad-bg ok">동의 · {ymd(t.agreedAt)}</span> : <span className="ad-bg wait">{p.status === 'APPLIED' ? '입점 심사 뒤 동의' : '동의 기록 없음'}</span>,
      `${t.code} · 약관 동의 기록`]),
    ['사업자 상태 조회', docs.data.nts.status ? <span className={`ad-bg ${docs.data.nts.status === 'VALID' ? 'ok' : 'no'}`}>{NTS[docs.data.nts.status] ?? docs.data.nts.status}</span> : <span className="ad-bg">조회 전</span>,
      `국세청 조회${docs.data.nts.checkedAt ? ` · ${ymd(docs.data.nts.checkedAt)}` : ''}${docs.data.nts.env && docs.data.nts.env !== 'LIVE' ? ` · ${docs.data.nts.env === 'STUB' ? '스텁(T-07)' : '시험'}` : ''}`],
    ...(docs.data.qualifications.length
      ? docs.data.qualifications.map((q): [string, JSX.Element, string] => [`업종 자격 — ${q.name}`,
          <span className={`ad-bg ${q.state === 'APPROVED' ? 'ok' : q.state === 'PENDING' ? 'wait' : 'no'}`}>{q.state === 'APPROVED' ? '승인' : q.state === 'PENDING' ? '확인 대기' : '반려'}</span>, q.code])
      : [['업종 자격', <span className="ad-bg ok">해당 없음 · 확인</span>, c?.category ?? '—'] as [string, JSX.Element, string]]),
  ] : [];
  return (
    <section data-ptn-detail={p.id}>
      {/* 제목 · 설명은 위 제목 줄(SUB_PAGE 'partners/detail') */}
      <div className="ad-prof" data-ptn-prof="">
        <div className="av">{p.company.replace(/^\(주\)|^주식회사\s*/, '').slice(0, 1)}</div>
        <div className="pi">
          <b>{p.company}</b> <span className={`ad-bg ${stc}`}>{stl}</span>
          <div className="ps">{p.id.slice(0, 8)} · {bizNo(p.bizRegNo)} · {ymd(p.appliedAt)} 입점{p.approvedAt ? ` · 승인 ${ymd(p.approvedAt)}` : ''}</div>
          <div className="ps">{c?.category ?? '업종 없음'}{c?.formLabel ? ` · 단가 방식 ${c.formLabel}` : ''} · 대표 {p.ceoName ?? '—'} · 등급 {p.grade}</div>
          <div className="ps">서비스 지역 {p.regions.length ? p.regions.map((r) => `${r.sido}${r.sigungu ? ' ' + r.sigungu : ''}`).join(' · ') : '없음'}</div>
          {/* 개발에만 있던 「미청구 · 한도」 줄은 그대로 둡니다(v10.31 상세 표) */}
          <div className="ps" data-ptn-unpaid="">미청구 {n(p.unpaid)}원 / 한도 {n(p.unpaidCap)}원</div>
        </div>
      </div>
      {warn && <div className="ad-nt warn"><b>{warn}</b>{p.suspendedReason && p.status !== 'REJECTED' ? ` ${p.suspendedReason}` : ''}</div>}
      <div className="ad-kc4">
        <div><span className="kv">{p.services.length}</span><span className="kl">서비스</span></div>
        <div><span className="kv">{n(leads)}</span><span className="kl">받은 리드 <small>무효 포함</small></span></div>
        <div><span className="kv">{c ? `${n(c.cash)}원` : '—'}</span><span className="kl">리드 이용료 잔액</span></div>
        <div><span className={`kv${p.stopped ? ' bad' : ''}`}>{p.stopped ? '수신 멈춤' : '수신 중'}</span><span className="kl">리드 수신</span></div>
      </div>
      <h3 className="ad-s2">계약 · 서류</h3>
      {docs.error ? <ErrorView error={docs.error} onRetry={docs.reload} /> : !docs.data ? <p className="muted">불러오는 중…</p> : (
        <div className="ad-tw"><table className="tbl" data-ptn-docs>
          <thead><tr><th>항목</th><th>상태</th><th>근거</th></tr></thead>
          <tbody>{docRows.map(([k, v, why]) => <tr key={k}><td>{k}</td><td>{v}</td><td className="muted">{why}</td></tr>)}</tbody>
        </table></div>
      )}
      <h3 className="ad-s2">서비스 {p.services.length}개</h3>
      {p.services.length === 0 ? <div className="ad-nt info"><b>아직 등록한 서비스가 없습니다.</b> 입점 · 자격 심사를 마치면 서비스를 등록합니다.</div> : (
        <div className="ad-tw"><table className="tbl"><thead><tr><th>서비스</th><th>업종</th><th>상태</th><th>등록</th></tr></thead><tbody>
          {p.services.map((s) => { const [k, t] = SVC[s.status] ?? ['', s.status]; return (
            <tr key={s.id}><td>{s.title}</td><td>{s.category} <span className="muted">{s.gwanCode}</span></td>
              <td><span className={`ad-bg ${k}`}>{t}</span>{s.rejectReason ? <span className="muted"> {s.rejectReason}</span> : ''}</td><td className="muted">{ymd(s.createdAt)}</td></tr>); })}
        </tbody></table></div>)}
      {/* 개발에만 — 리드 이용료 상태별 건수 · 합계(10/10 답: 개발에만 있는 것은 남김) */}
      <h3 className="ad-s2">리드 이용료</h3>
      {p.fees.length === 0 ? <p className="ad-empty">아직 받은 리드가 없습니다.</p> : (
        <div className="ad-tw"><table className="tbl"><thead><tr><th>상태</th><th>건수</th><th>합계</th></tr></thead><tbody>
          {p.fees.map((f) => <tr key={f.state}><td>{FEE_STATE[f.state] ?? f.state}</td><td className="num-cell">{n(f.count)}</td><td className="num-cell">{n(f.amount)}원</td></tr>)}
        </tbody></table></div>)}
      <h3 className="ad-s2">처리 바로가기</h3>
      <div className="ad-dact" style={{ marginTop: 0 }}>
        <button className="btn-plain" onClick={() => onGo('apply')}>입점 신청</button>
        <button className="btn-plain" onClick={() => onGo('services')}>서비스 검수</button>
        <button className="btn-plain" onClick={() => onGo('wallet')}>리드 이용료</button>
        <button className="btn-plain" onClick={() => onGo('quals')}>자격 심사</button>
        <button className="btn-plain" onClick={onClose} data-ptn-close="">← 파트너사 목록</button>
      </div>
    </section>
  );
}

const PAGE_SIZE = 20;
function PartnerList({ onGo, onOpen }: { onGo: (v: Tab2) => void; onOpen: (id: string) => void }) {
  const list = useApi<Partner[]>('/admin/partners');
  /* v10.31 — 시안 칸 「의료 심의」 건수(자격 심사 › 의료 심의가 쓰는 API 그대로) */
  const medical = useApi<unknown[]>('/admin/qualifications/medical');
  /* v10.29 — 시안 숫자 칸(입점 신청 · 서비스 검수 · 리드 반려 신청)의 건수. 각 하위 탭이 쓰는 API 그대로 */
  const svc = useApi<PendingService[]>('/admin/partners/services/pending');
  const voids = useApi<VoidList>('/admin/partners/fees/void-requests?state=REQUESTED');
  const cards = useApi<PartnerCard[]>('/admin/partners/cards');
  const [more, setMore] = useState(PAGE_SIZE);
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const rows = list.data;
  const waiting = rows.filter((p) => p.status === 'APPLIED');
  const stopped = rows.filter((p) => Number(p.unpaid) >= Number(p.unpaidCap));
  const card = (id: string) => (cards.data ?? []).find((c) => c.id === id);

  const tiles: [string, number | null, string, Tab2][] = [
    ['입점 신청', waiting.length, 'T-01 · 승인 전에는 리드가 가지 않음', 'apply'],
    ['서비스 검수', svc.data ? svc.data.length : null, 'T-02 · 검수중 → 노출중', 'services'],
    ['의료 심의', medical.data ? medical.data.length : null, 'T-03 · 심의필 본사 확인', 'medical'],
    ['리드 반려 신청', voids.data ? voids.data.items.length : null, 'T-04 · 인정 / 기각', 'rejects'],
  ];
  return (
    <>
      <div className="ad-tiles" data-ptn-tiles>
        {tiles.map(([t, v, sub, go]) => (
          <button key={t} className="ad-tile" onClick={() => onGo(go)}>
            <span className="tl">{t}</span><b>{v == null ? '—' : n(v)}</b><span className="tu">건</span>
            <span className="ts">{sub}</span>
          </button>
        ))}
      </div>
      {/* v10.32 — 시안 노란 띠(전: 파란 띠) · 표에 「관련 화면」 칸 */}
      <div className="ad-nt warn"><b>아래 7건은 화면이 없어서 멈췄던 업무입니다.</b> 지금은 모두 처리할 자리가 있습니다 — 「열기」로 그 화면에 갑니다.</div>
      <div className="ad-tw"><table className="tbl" data-ptn-blocked>
        <thead><tr><th>ID</th><th>막힌 업무</th><th>현재 상태</th><th>관련 화면</th><th></th></tr></thead>
        <tbody>
          {BLOCKED.map(([t, name, why, v, scr]) => (
            <tr key={t}>
              <td className="mono">{t}</td><td><b>{name}</b></td><td className="muted">{why}</td><td className="mono">SB-ADM-{scr}</td>
              <td><button className="btn-sm" onClick={() => onGo(v)}>열기</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {/* v10.32 — 시안 「입점 파트너사 N곳」 카드 줄(전: 118줄 표). 20곳씩 더 봅니다 */}
      <h2 className="ad-s2">입점 파트너사 {rows.length}곳</h2>
      {/* v10.32 — 개발에만 있던 모아 보기 띠 두 줄은 그대로 둡니다(「그대로 둠」 · v10.31 과 같은 글자) */}
      {waiting.length > 0 && (
        <div className="ad-nt warn" data-ptn-waiting={waiting.length}><b>입점 심사 대기 {waiting.length}건.</b> 승인 전에는 리드가 가지 않습니다.{' '}
          <button className="linkbtn" onClick={() => onGo('apply')}>입점 신청으로</button></div>
      )}
      {stopped.length > 0 && (
        <div className="ad-nt warn" data-ptn-stopped={stopped.length}>
          <b>미납 한도 초과 {stopped.length}개사 — 리드 수신이 멈췄습니다.</b> 청구분이 결제되면 자동으로 재개됩니다.
        </div>
      )}
      {rows.length === 0 && <p className="ad-empty">등록된 파트너가 없습니다.</p>}
      {rows.slice(0, more).map((p) => {
        const c = card(p.id);
        const warn = partnerWarn(p, c);
        const [stc, stl] = PST[p.status] ?? ['', p.status];
        return (
          <div key={p.id} className={`ad-mrow${warn ? ' warn' : ''}`} data-ptn-row={p.id}>
            <div className="mt">
              <b>{p.company}</b>
              <span className="ls">{p.id.slice(0, 8)} · {bizNo(p.bizRegNo)}{c?.category ? ` · ${c.category}` : ''}{c?.formLabel ? ` · ${c.formLabel}` : ''} · {ymd(p.appliedAt)} 입점 · 등급 {p.grade}</span>
              {warn && <div className="wn">{warn}</div>}
            </div>
            <div className="mm">
              <span className={`ad-bg ${stc}`}>{stl}</span>
              <span className="ls">서비스 {n(p.services)} · 리드 {c ? n(c.leads) : '—'} · 리드 이용료 {c ? `${n(c.cash)}원` : '—'}</span>
            </div>
            <div className="mact"><button className="btn-sm" data-ptn-open={p.id} onClick={() => onOpen(p.id)}>상세</button></div>
          </div>
        );
      })}
      {rows.length > more && (
        <div className="ad-dact"><button className="btn-plain" onClick={() => setMore(more + PAGE_SIZE)} data-ptn-more>더 보기 (남은 {rows.length - more}곳)</button></div>
      )}
    </>
  );
}

/* ── SB-ADM-PTN-020 입점 신청 승인 · 반려 (T-01) ─────────────────── */
function Apply() {
  const list = useApi<Partner[]>('/admin/partners');
  const a = useAct();
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const rows = list.data.filter((p) => p.status === 'APPLIED');
  const rejected = list.data.filter((p) => p.status === 'REJECTED');

  const approve = (p: Partner) => a.run(p.id, () => api(`/admin/partners/${p.id}/approve`, { method: 'POST' }),
    list.reload, `${p.company} 승인했습니다. 파트너센터 온보딩이 열립니다.`);
  const reject = (p: Partner) => {
    const reason = prompt(`${p.company} 입점 반려 사유 — 무엇을 갖춰야 다시 신청할 수 있는지까지 적어 주십시오`) ?? '';
    if (!reason.trim()) return;
    void a.run(p.id, () => api(`/admin/partners/${p.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
      list.reload);
  };

  return (
    <>
      <h2>입점 신청 승인 <em>{rows.length}</em></h2>
      <p className="lead">신청은 심사 대기로 저장되고, 여기서 승인 또는 반려합니다 (T-01).</p>
      <p className="card warn">
        <b>국세청(NTS) 서비스키가 아직 발급되지 않아 사업자 상태가 항상 &ldquo;계속사업자&rdquo;로 옵니다(T-07).</b>{' '}
        PASS 본인인증도 스텁입니다(T-18). 두 값은 지금 판단 근거로 쓰지 마십시오.
      </p>
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">대기 중인 입점 신청이 없습니다.</p>}
      {rows.map((p) => (
        <div key={p.id} className="card row" data-partner={p.id}>
          <div className="row-main">
            <strong>{p.company}</strong>
            <span className="dim">{bizNo(p.bizRegNo)} · {p.personal ? (p.actorOk ? '본인인증 완료' : '본인인증 전') : p.bizVerified ? '사업자 인증 완료' : '사업자 미인증'} · 신청 {ymdhm(p.appliedAt)}</span>
          </div>
          <div className="row-act">
            <button className="btn-ok" disabled={a.busy === p.id} onClick={() => void approve(p)}>승인</button>{' '}
            <button className="btn-no" disabled={a.busy === p.id} onClick={() => reject(p)}>반려</button>
          </div>
        </div>
      ))}
      <p className="card">
        <b>승인하면 열리는 것</b> — PASS 인증 · 첫 로그인 · 서비스 등록 게이트 · 정산 계좌 등록.
        인증되지 않은 사업자는 DB 가 승인을 막습니다. <b>반려 사유는 신청자에게 그대로 보이고</b>, 신청자는 고쳐서 다시 신청할 수 있습니다.
      </p>
      {rejected.length > 0 && (
        <>
          <h3 className="sec">반려한 신청 <em>{rejected.length}</em></h3>
          <table className="tbl">
            <thead><tr><th>파트너</th><th>사유</th><th>신청</th></tr></thead>
            <tbody>
              {rejected.map((p) => (
                <tr key={p.id}><td><b>{p.company}</b></td><td className="muted">{p.rejectReason ?? '—'}</td><td className="muted">{ymdhm(p.appliedAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3 className="sec">사업자 정보 변경 요청 <small className="dim">파트너센터 › 회사 정보에서 낸 것 — 승인하면 바로 반영</small></h3>
      <ChangeRequests />
    </>
  );
}

/* ── SB-ADM-PTN-030 서비스 검수 승인 (T-02) ──────────────────────── */
const REASONS = [
  ['R01', '금칙어 · 과장 표현'], ['R02', '정보 불충분'], ['R03', '가격 표시 부정확'],
  ['R04', '카테고리 부적합'], ['R05', '자격 · 인허가 미확인'], ['R06', '중복 등록'],
];
const QUAL: Record<string, string> = { APPROVED: '자격 승인', PENDING: '자격 심사 중', REJECTED: '자격 반려' };

function Services() {
  const list = useApi<PendingService[]>('/admin/partners/services/pending');
  const [form, setForm] = useState<Record<string, { code: string; detail: string }>>({});
  const a = useAct();
  const f = (id: string) => form[id] ?? { code: 'R02', detail: '' };
  const set = (id: string, v: Partial<{ code: string; detail: string }>) => setForm({ ...form, [id]: { ...f(id), ...v } });

  const review = (s: PendingService, approve: boolean) => {
    const { code, detail } = f(s.id);
    const label = REASONS.find((r) => r[0] === code)?.[1];
    if (!approve && !detail.trim()) { a.setErr('반려에는 무엇을 고쳐야 하는지까지 적어 주십시오.'); return; }
    const reason = approve ? undefined : `${code} ${label} — ${detail.trim()}`;
    void a.run(s.id, () => api(`/admin/partners/services/${s.id}/review`, {
      method: 'POST', body: JSON.stringify({ approve, reason }),
    }), list.reload, approve ? `「${s.title}」 승인했습니다. 노출중으로 바뀌고 승인·반려 이력에 찍힙니다.`
      : `「${s.title}」 반려했습니다. 사유가 파트너에게 그대로 보입니다.`);
  };

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const rows = list.data ?? [];
  return (
    <>
      <h2>서비스 검수 승인 <em>{rows.length}</em></h2>
      <p className="lead">검수중 → 노출중 전환입니다 (T-02). 오래된 신청부터 보입니다.</p>
      <Flash msg={a.msg} err={a.err} />
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && rows.length === 0 && <p className="muted">검수 대기 중인 서비스가 없습니다.</p>}
      {rows.map((s) => (
        <div key={s.id} className="card pad" data-service={s.id}>
          <b>{s.title}</b> <span className="muted">{s.company} · {s.categoryName ?? '분야 미지정'}{s.gwanCode ? ` (${s.gwanCode})` : ''}</span>
          <p className="muted">
            제출 {ymdhm(s.submittedAt)} · {bizNo(s.bizRegNo)} · 파트너 {STATUS[s.partnerStatus] ?? s.partnerStatus} · 등급 {s.grade}
            {' · '}이전 승인 {s.approvedBefore} / 반려 {s.rejectedBefore}
            {s.leadFee ? ` · 리드 단가 ${n(s.leadFee)}원` : ''}
          </p>
          {s.body && <p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p>}
          {s.restrictedCode && <p className="warn-text">제한업종({s.restrictedCode}) 분야입니다 — 승인해도 노출되지 않습니다.</p>}
          {s.qualCode && (
            <p className={s.qualState === 'APPROVED' ? 'muted' : 'warn-text'}>
              규제 분야({s.qualCode}) — {s.qualState ? QUAL[s.qualState] ?? s.qualState : '자격 미제출'}.
              {s.qualState !== 'APPROVED' ? ' 자격 심사가 끝나기 전에는 승인하지 마십시오.' : ''}
            </p>
          )}
          <div className="form-grid">
            <label><span>반려 사유 코드</span>
              <select value={f(s.id).code} onChange={(e) => set(s.id, { code: e.target.value })}>
                {REASONS.map(([c, l]) => <option key={c} value={c}>{c} {l}</option>)}
              </select>
            </label>
            <label><span>무엇을 고쳐야 하나 (반려 시 필수)</span>
              <input value={f(s.id).detail} onChange={(e) => set(s.id, { detail: e.target.value })} />
            </label>
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === s.id} onClick={() => review(s, true)}>승인</button>
            <button className="btn-no" disabled={a.busy === s.id} onClick={() => review(s, false)}>반려</button>
          </div>
        </div>
      ))}
      <p className="card">
        <b>반려 사유는 소개뱅크 검수와 같은 코드(R01~R06)를 씁니다.</b> &lsquo;부적절&rsquo;만 쓰면 같은 것을
        다시 내고 검수 큐가 그만큼 늘어납니다 — 서버가 사유 없는 반려를 막습니다.
      </p>
    </>
  );
}

/* ── SB-ADM-PTN-050 리드 반려 인정 / 기각 (T-04) ─────────────────── */
const DISPUTE: Record<string, string> = {
  FALSE_INFO: '허위 정보', UNREACHABLE: '연락 불가', DUPLICATE: '중복 리드', OUT_OF_SCOPE: '지역 · 분야 밖',
};
const DSTATE: Record<string, string> = { REQUESTED: '대기', ACCEPTED: '인정', DISMISSED: '기각' };

function Rejects() {
  const [tab, setTab] = useState<'REQUESTED' | 'ALL'>('REQUESTED');
  const list = useApi<VoidList>(`/admin/partners/fees/void-requests?state=${tab}`);
  const [rule, setRule] = useState<Record<number, string>>({});
  const a = useAct();

  const accept = (r: VoidRequest) => {
    const code = rule[r.id] ?? 'RSK-02';
    if (!confirm(`이용료 ${r.feeId}번(${n(r.amount)}원)을 무효로 합니다 — 근거 ${code}.\n거래 자체가 없던 것이 됩니다. 되돌릴 수 없습니다.`)) return;
    void a.run(`v${r.id}`, () => api(`/admin/partners/fees/void-requests/${r.id}/accept`, {
      method: 'POST', body: JSON.stringify({ ruleCode: code }),
    }), list.reload);
  };
  const dismiss = (r: VoidRequest) => {
    const reason = prompt('기각 사유 — 파트너에게 그대로 보입니다') ?? '';
    if (!reason.trim()) return;
    void a.run(`v${r.id}`, () => api(`/admin/partners/fees/void-requests/${r.id}/dismiss`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }), list.reload);
  };

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const rows = list.data?.items ?? [];
  const rules = list.data?.rules ?? [];
  const hrs = (from: string, to: string) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 3600000));
  /* v10.32 — 시안(scAdmPtnRej) 배치: 노란 띠 → 파란 띠(자격 세 조건) → 신청 카드(사유 제목 · 번호 · 회사 · 리드 · 확인비용 · 신청 / 접수 시간 · 열람 · 한도 칩 · 상태 · 인정 / 기각).
   * 대기 · 전체 칩 · 근거 줄 · 위험감지 규칙 고르기는 개발에만(그대로 둠) */
  return (
    <>
      {/* 제목 · 설명은 위 제목 줄(SUB_PAGE 'partners/rejects') */}
      <div className="ad-nt warn">
        <b>인정에는 위험감지 규칙 근거가 필요합니다. 기각하면 이용료는 그대로 청구되고, 사유가 파트너에게 보입니다.</b> 당사자 간 상담 결렬은 무효 사유가 아닙니다 — 그것까지 판정하면
        플랫폼이 거래 당사자가 됩니다.
      </div>
      <div className="ad-nt info">
        <b>신청 자격은 서버가 이미 걸렀습니다</b> — 리드 접수 72시간 이내 · 이용료 한 건에 한 번 · 월 한도(당월 수신 건수의 15%).
        이용료는 열람 시점에 생기므로 &ldquo;미열람&rdquo; 조건은 이 모델에 없습니다.
      </div>
      <div className="ad-flt" role="tablist" aria-label="반려 신청 상태">
        <button role="tab" aria-selected={tab === 'REQUESTED'} className={tab === 'REQUESTED' ? 'on' : ''} onClick={() => setTab('REQUESTED')}>대기{tab === 'REQUESTED' && list.data ? <i>{rows.length}</i> : null}</button>
        <button role="tab" aria-selected={tab === 'ALL'} className={tab === 'ALL' ? 'on' : ''} onClick={() => setTab('ALL')}>전체 (판정 이력)</button>
      </div>
      <Flash msg={a.msg} err={a.err} />
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && rows.length === 0 && <p className="ad-empty">{tab === 'REQUESTED' ? '대기 중인 반려 신청이 없습니다.' : '반려 신청이 없습니다.'}</p>}
      {rows.map((r) => {
        const h = hrs(r.deliveredAt, r.requestedAt);
        const cap = Math.floor(r.monthReceived * 0.15);
        return (
          <div key={r.id} className="ad-mrow" data-void={r.id}>
            <div className="mt">
              <b>{DISPUTE[r.reasonCode] ?? r.reasonCode} — {r.reason}</b>
              <span className="ls">J-{r.id} · {r.company} · 리드 {r.summary}{r.sido ? ` (${[r.sido, r.sigungu].filter(Boolean).join(' ')})` : ''}{r.categoryName ? ` · ${r.categoryName}` : ''} · 확인비용 {n(r.amount)}원 · 신청 {ymdhm(r.requestedAt)}</span>
              <div className="lh">
                <span className={`ad-chip${h > 72 ? ' warn' : ''}`}>접수 {h}시간</span>
                <span className="ad-chip">{r.viewedAt ? `열람 ${ymdhm(r.viewedAt)}` : '미열람'}</span>
                <span className="ad-chip">한도 {r.monthRequested} / {r.monthReceived}건(15% · {cap}건)</span>
                <span className="ad-chip">이용료 {r.feeId}번 · 등급 {r.grade}</span>
              </div>
              <span className="ls">근거: {r.evidence ?? <span className="warn-text">제출 없음</span>} · 이달 이 파트너: 수신 {r.monthReceived}건 · 반려 신청 {r.monthRequested}건</span>
              {r.state !== 'REQUESTED' && (
                <span className="ls">{DSTATE[r.state]} · {r.decidedBy ?? '—'} · {ymdhm(r.decidedAt)}
                  {r.ruleCode ? ` · 근거 ${r.ruleCode}` : ''}{r.decisionReason ? ` · ${r.decisionReason}` : ''}</span>
              )}
            </div>
            <div className="mm">
              <span className={`ad-bg ${r.state === 'ACCEPTED' ? 'ok' : r.state === 'DISMISSED' ? 'no' : 'wait'}`}>{r.state === 'REQUESTED' ? '승인 대기' : DSTATE[r.state] ?? r.state}</span>
            </div>
            {r.state === 'REQUESTED' && (
              <div className="mact">
                <select value={rule[r.id] ?? 'RSK-02'} onChange={(e) => setRule({ ...rule, [r.id]: e.target.value })} aria-label="위험감지 규칙 근거">
                  {rules.map((x) => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}
                </select>
                <button className="btn-plain btn-sm" disabled={a.busy === `v${r.id}`} onClick={() => dismiss(r)}>기각</button>
                <button className="btn-ok btn-sm" disabled={a.busy === `v${r.id}`} onClick={() => accept(r)}>인정 · 무효 처리</button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ── SB-ADM-PTN-080 이용료 · 등급 ────────────────────────────────── */
const RATIO: Array<[string, number, string]> = [
  ['S', 1.0, '확정'], ['A+', 0.85, '확정'], ['A', 0.72, '확정'], ['A-', 0.6, '확정'],
  ['B+', 0.48, '미응답'], ['B', 0.33, '미응답'], ['B-', 0.22, '미응답'], ['C', 0.12, '발송실패'],
];

function Wallet({ onGo }: { onGo?: (tab: string) => void }) {
  const fees = useApi<FeeRow[]>('/admin/partners/fees');
  if (fees.error) return <ErrorView error={fees.error} onRetry={fees.reload} />;
  if (!fees.data) return <p className="muted">불러오는 중…</p>;
  const rows = fees.data;

  /* v10.31 (10/10 시안 · scAdmPtnW) — 시안 순서: 안내 → 입금 확인 대기 → 등급별 확인비용 비율 → 법률 · 세무 월 정액 노출.
   * 리드 이용료는 W5 가 선불 충전 잔액으로 바꿨습니다(D070) — 잔액 · 원장 · 세금계산서 구역은 W5 API(/admin/partner-center/cash · lead-cash-invoices · rules)를 씁니다(v10.31 합침으로 연결). */
  return (
    <>
      <div className="ad-nt">PG · 가상계좌 입금대사가 연동되어 있지 않아 본사가 수기로 확인합니다(T-19). 리드 이용료 자동 충전은 파트너가 등록한 카드로 결제합니다(정기 작업 lead_cash_auto · 30분마다 — 실패는 1시간 뒤 다시).</div>
      <h2 className="ad-s2">입금 확인 대기 · 선불 충전 잔액</h2>
      <CashWallets />
      <h3 className="sec">후불 미청구 · 한도 <small className="dim">선불 전환 전 발생분</small></h3>
      {rows.length === 0 && <p className="muted">이용료가 발생한 파트너가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>파트너</th><th>등급</th><th>미청구</th><th>한도</th><th>무효</th><th>수신</th></tr></thead>
          <tbody>
            {rows.map((f) => {
              const over = Number(f.unpaid) >= Number(f.unpaidCap);
              return (
                <tr key={f.partnerId}>
                  <td>{f.company}</td><td>{f.grade}</td>
                  <td className="num-cell">{n(f.unpaid)}원</td>
                  <td className="num-cell">{n(f.unpaidCap)}원</td>
                  <td className="num-cell">{n(f.voided)}</td>
                  <td>{over ? <b className="warn-text">중지</b> : '정상'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

<h3 className="sec">등급별 확인비용 비율</h3>
      <table className="tbl">
        <thead><tr><th>등급</th><th>비율</th><th>붙는 조건</th></tr></thead>
        <tbody>
          {RATIO.map(([g, r, c]) => (
            <tr key={g}><td><b>{g}</b></td><td className="num-cell">{Math.round(r * 100)}%</td><td className="muted">{c}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="card warn">
        <b>파트너는 최고 확인비용 하나만 정하고, 나머지 7등급은 비율표가 채웁니다.</b> 어느 등급이 붙을지는
        알림톡 수신 결과가 정하는데, 알림톡 · SMS 연동 전이라 신뢰 판정이 항상 통과로 채워집니다(T-10).
        지금 등급은 신뢰할 수 없습니다.
      </p>
      <h3 className="sec">충전 보너스 비율 · 파트너 등급 기준</h3>
      <CashRules />
      <h3 className="sec">리드 이용료 세금계산서 발행 요청</h3>
      <CashInvoices />
      <h2 className="ad-s2">법률 · 세무 월 정액 노출 — 월 노출료 기준 금액</h2>
      <div className="ad-nt info">
        월 노출료 기준 금액(directory.monthly_fee)과 「입금 확인 → 노출 켜기」는 같은 API 를 쓰는 「법률·세무 정액 노출」 화면에 있습니다 — 두 곳에 두지 않습니다.
        {onGo && <> <button className="btn-plain btn-sm" onClick={() => onGo('directory')}>기준 금액 · 노출 켜기로</button></>}
      </div>
    </>
  );
}
