import { useEffect, useState } from 'react';
import { ymdKst } from '../../lib/format';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { useHashSub } from '../../lib/hashSub';

interface Rule {
  categoryCode: string; categoryName: string;
  requiredDoc: string; legalBasis: string; needsLookup?: boolean; pending: number;
}
interface Review {
  id: string; company: string; categoryCode: string; categoryName: string;
  docNo: string | null; lookupDone: boolean;
  requiredDoc: string; legalBasis: string; createdAt?: string;
}
interface Property {
  listingId: string; title: string; company: string | null;
  brokerRegNo: string | null; sido: string | null; sigungu: string | null;
  dealType: string | null; price: string | null; brokerOk: boolean;
}
interface Broker {
  id: string; state: string; licenseNo: string; officeName: string | null; ceoName: string | null;
  lookupResult: string | null; lookupAt: string | null; recheckDue: string | null;
  /** D008 — API 실제 조회 · ASSUMED 간주 · MANUAL 수기. 비면 미조회 */
  lookupSource?: string | null; lookupDetail?: string | null;
  rejectReason: string | null; decidedAt: string | null; decidedBy: string | null; createdAt: string;
  businessId: string; company: string; bizRegNo: string | null; bizCeoName: string; bizVerified: boolean; personal?: boolean;
  ntsStatus: string | null; sido: string | null; sigungu: string | null; accountEmail: string;
  ceoMatch: boolean; canPublish: boolean; malWaiting: number; malPublished: number; assumed?: boolean;
}
interface BrokerList {
  items: Broker[]; assumed: boolean; lookupConfigured?: boolean;
  counts: { pending: number; verified: number; rejected: number; expired: number };
  /** v10.27 (G-207) — 쪽 나눔 · 찾기 · 순서 */
  total?: number; page?: number; pages?: number; size?: number; order?: string; q?: string | null;
}
/** v10.32 — GET /admin/qualifications/category-master (시안 admptnc 세 구역) */
interface CatMaster {
  consult: Array<{ code: string; name: string; status: string; consultMode: string | null;
    publishMode: 'GATED' | 'OPEN'; state: 'OPEN' | 'PENDING' | 'LISTING_FEE' | 'INACTIVE'; legalBasis: string | null }>;
  forms: Array<{ code: string; name: string; gwanCode: string; form: string | null; formLabel: string | null; steps: number | null;
    axis: { rows: number; cols: number } | null; regulation: string | null; baseFee: number | null; services: number;
    priceInput: boolean; blocked: 'NO_FORM' | 'NO_AXES' | null }>;
  matrices: Array<{ code: string; name: string; rows: Array<{ key: string; label: string }>; cols: Array<{ key: string; label: string }>; base: null }>;
}
interface Medical {
  creativeCode: string; advertiser: string;
  category: string; reviewNo: string | null; confirmedAt?: string | null;
}

type View = 'pending' | 'broker' | 'detail' | 'cats' | 'medical';

/**
 * SB-ADM-PTN-070 규제 카테고리 자격 심사 (T-21)
 * SB-ADM-BRK-010 중개사 인증 심사
 * SB-ADM-BRK-011 중개사 인증 상세
 * SB-ADM-PTN-060 카테고리 마스터 (T-05 · T-06) — 규제 분야 기준 · 매물 심사
 * SB-ADM-PTN-040 의료 심의 본사 확인 (T-03)
 *
 * 자격 없이 등록되면 **플랫폼도 책임을 집니다.**
 * 중개자 면책은 "고지하고 확인한 범위"에서만 성립하고,
 * 자격 확인이 그 '확인'입니다.
 *
 * 중개사 인증(BRK)은 2026-10-02 부터 자기 API(/admin/brokers)를 씁니다 —
 * 사이트 /my/broker 신청이 쌓이는 broker_verifications 를 판정하고, 승인하면
 * 부동산 매물 공개 게이트(fn_broker_gate)가 열립니다.
 * 규제 자격 심사(PTN-070, qualification_reviews)는 그대로입니다.
 */
/* v10.31 (10/10 시안 · PTN-040/060/070) — 시안은 의료 심의 · 카테고리 마스터 · 자격 심사 화면 위에 파트너사 하위 탭 줄을 같이 보입니다.
 * 화면은 여기(인증 심사 › 자격 심사)에 하나만 두고, 파트너사 쪽 하위 화면으로 가는 줄을 둡니다. */
const PTN_LINKS: Array<[string, string]> = [
  ['partners/list', '파트너사 목록'], ['partners/apply', '입점 신청'], ['partners/services', '서비스 검수'],
  ['partners/rejects', '리드 반려'], ['partners/leads', '리드 배정'], ['partners/wallet', '리드 이용료 · 정산'],
];

export function Qualifications({ onGo }: { onGo?: (tab: string) => void } = {}) {
  /* v10.31 — 파트너사 하위 탭(의료 심의 · 카테고리 마스터 · 자격 심사)에서 주소(#/quals/medical)로 바로 들어옵니다 */
  const [view, setView] = useHashSub<View>('pending', ['pending', 'broker', 'detail', 'cats', 'medical']);
  const [pick, setPick] = useState<string | null>(null);
  const [bstate, setBstate] = useState('PENDING');
  /* v10.27 (G-207) — 전에는 오래된 것부터 200건까지만 와서 대기가 200건을 넘으면 새 신청이 보이지 않았습니다 */
  const [bq, setBq] = useState(''); const [border, setBorder] = useState(''); const [bpage, setBpage] = useState(1);
  const brokers = useApi<BrokerList>(`/admin/brokers?state=${bstate}&page=${bpage}&size=50${bq ? `&q=${encodeURIComponent(bq)}` : ''}${border ? `&order=${border}` : ''}`);
  const pending = useApi<Review[]>('/admin/qualifications');
  const a = useAct();

  const tabs: SubTab<View>[] = [
    { key: 'pending', label: '규제 자격 심사 (T-21)', screen: 'SB-ADM-PTN-070' },
    { key: 'broker', label: '중개사 인증 심사', screen: 'SB-ADM-BRK-010' },
    { key: 'detail', label: '인증 상세', screen: 'SB-ADM-BRK-011' },
    { key: 'cats', label: '카테고리 마스터 (T-05·06)', screen: 'SB-ADM-PTN-060' },
    { key: 'medical', label: '의료 심의 (T-03)', screen: 'SB-ADM-PTN-040' },
  ];

  /* 발급처 조회 → 승인/반려. 목록과 상세가 같은 처리를 씁니다. */
  async function act(id: string, kind: 'lookup' | 'ok' | 'no') {
    if (kind === 'lookup') {
      await a.run(id, () => api(`/admin/qualifications/${id}/lookup`, { method: 'POST' }),
        pending.reload, '발급처 조회를 완료로 표시했습니다. 이제 승인할 수 있습니다.');
      return;
    }
    const reason = kind === 'no' ? prompt('반려 사유 — 무엇이 부족한지까지 적어 주십시오') ?? '' : undefined;
    if (kind === 'no' && !reason?.trim()) return;
    await a.run(id, () => api(`/admin/qualifications/${id}/decide`, {
      method: 'POST', body: JSON.stringify({ approve: kind === 'ok', reason }),
    }), pending.reload, kind === 'ok' ? '자격을 승인했습니다. 그 업종의 서비스 등록이 열립니다.' : '반려했습니다.');
  }

  const open = (id: string) => { setPick(id); setView('detail'); a.clear(); };
  const all = pending.data ?? [];

  /* 중개사 인증 판정. 승인은 국토부 대조 MATCH 가 아니면 DB 가 막습니다. */
  /* v10.32 — preset: 상세의 반려 사유 코드(BR03 · BR04 · BR06) 단추가 사유 글 앞부분을 채워 둡니다(고쳐 쓸 수 있음 · 서버 입력은 그대로 reason 글) */
  async function decideBroker(b: Broker, state: 'VERIFIED' | 'REJECTED', preset?: string) {
    const reason = state === 'REJECTED' ? prompt('반려 사유 — 무엇이 맞지 않았는지까지 적어 주십시오 (신청자에게 보입니다)', preset) ?? '' : undefined;
    if (state === 'REJECTED' && !reason?.trim()) return;
    if (state === 'VERIFIED' && !confirm(`${b.company} (${b.licenseNo}) 중개사 인증을 승인합니다.\n이 사업자의 부동산 매물 공개가 열립니다.`)) return;
    await a.run(b.id, () => api(`/admin/brokers/${b.id}/decide`, {
      method: 'POST', body: JSON.stringify({ state, reason }),
    }), brokers.reload);
  }

  /* D008 — 국토부 다시 조회. 조회 실패면 기존 결과를 지우지 않고 사유만 남깁니다(서버). */
  async function relookup(b: Broker) {
    await a.run(b.id, () => api(`/admin/brokers/${b.id}/lookup`, { method: 'POST' }), brokers.reload);
  }

  return (
    <section>
      <SubTabs tabs={tabs} value={view} onChange={(v) => { a.clear(); setView(v); }} />
      {onGo && (view === 'pending' || view === 'cats' || view === 'medical') && (
        <div className="ad-chk" data-ptn-links style={{ flexWrap: 'wrap', margin: '-4px 0 10px' }}>
          <span className="dim" style={{ fontSize: 12.5 }}>파트너사</span>
          {PTN_LINKS.map(([to, t]) => <button key={to} className="btn-plain btn-sm" data-go={to} onClick={() => onGo(to)}>{t}</button>)}
        </div>
      )}
      <Flash msg={a.msg} err={a.err} />
      {pending.error && view === 'pending'
        ? <ErrorView error={pending.error} onRetry={pending.reload} />
        : null}

      {view === 'pending' && !pending.error && (
        <>
          <h2>규제 카테고리 자격 심사 <em>{all.length}</em></h2>
          <p className="lead">자격이 승인돼야 그 업종의 서비스 등록이 열립니다 (T-21).</p>
          <p className="card warn">
            <b>서류만 보고 승인하지 마십시오.</b> 발급처에서 조회해야 합니다 — 위조된 자격증으로 등록되면
            그 피해는 요청자에게 갑니다. 조회 없이는 DB 가 승인을 막습니다.
          </p>
          {!pending.data && <p className="muted">불러오는 중…</p>}
          {pending.data && all.length === 0 && <p className="muted">자격 심사 대기 건이 없습니다.</p>}
          {all.map((r) => <QualCard key={r.id} r={r} busy={a.busy === r.id} onAct={act} />)}
          <p className="card warn">
            <b>제한업종은 자격이 있어도 등록되지 않습니다.</b> 자격 심사는 규제 업종(의료 · 보험 등)의 적법한 등록을
            여는 절차이지, 제한업종을 여는 절차가 아닙니다.
          </p>
        </>
      )}

      {view === 'broker' && (
        <BrokerQueue list={brokers} state={bstate} onState={(s) => { setBstate(s); setBpage(1); }} busy={a.busy}
                     q={bq} onQ={(v) => { setBq(v); setBpage(1); }} order={border} onOrder={(v) => { setBorder(v); setBpage(1); }} onPage={setBpage}
                     onDecide={decideBroker} onOpen={open} />
      )}

      {view === 'detail' && (
        <BrokerDetail id={pick} busy={!!pick && a.busy === pick} version={brokers.data}
                      configured={!!brokers.data?.lookupConfigured} onLookup={relookup}
                      onDecide={decideBroker} onBack={() => setView('broker')} />
      )}

      {view === 'cats' && <Categories />}
      {view === 'medical' && <MedicalView onGo={onGo} />}
    </section>
  );
}

function QualCard({ r, busy, onAct }: {
  r: Review; busy: boolean; onAct: (id: string, k: 'lookup' | 'ok' | 'no') => void;
}) {
  return (
    <div className="card pad">
      <b>{r.company}</b> <span className="muted">{r.categoryName}</span>
      <p className="muted">필요 서류: {r.requiredDoc} · 근거: {r.legalBasis}</p>
      <p>제출 번호: {r.docNo ?? <span className="warn-text">미제출</span>} · 발급처 조회:{' '}
        {r.lookupDone ? <span className="badge badge-verified">완료</span> : <span className="badge badge-urgent">미완료</span>}</p>
      <div className="acts">
        {!r.lookupDone && <button className="btn-sm" disabled={busy} onClick={() => onAct(r.id, 'lookup')}>발급처 조회 완료</button>}
        <button className="btn-sm" disabled={!r.lookupDone || busy} onClick={() => onAct(r.id, 'ok')}>승인</button>
        <button className="btn-no" disabled={busy} onClick={() => onAct(r.id, 'no')}>반려</button>
      </div>
    </div>
  );
}

/* ── SB-ADM-BRK-010 중개사 인증 심사 ─────────────────────────────── */
const BST: Record<string, string> = {
  SUBMITTED: '접수', PENDING: '심사 대기', VERIFIED: '인증 완료', REJECTED: '반려', EXPIRED: '기한 만료',
};
const LK: Record<string, string> = { MATCH: '일치', MISMATCH: '불일치', NOT_FOUND: '등록 없음' };
const lookupView = (b: Broker) => b.lookupResult
  ? <span className={`st ${b.lookupResult === 'MATCH' ? 'ok' : 'no'}`}>{LK[b.lookupResult] ?? b.lookupResult}</span>
  : <span className="st no">미조회</span>;

function BrokerQueue({ list, state, onState, busy, onDecide, onOpen, q, onQ, order, onOrder, onPage }: {
  list: { data: BrokerList | null; error: unknown; reload: () => void };
  state: string; onState: (s: string) => void; busy: string | null;
  q: string; onQ: (v: string) => void; order: string; onOrder: (v: string) => void; onPage: (p: number) => void;
  onDecide: (b: Broker, s: 'VERIFIED' | 'REJECTED') => void; onOpen: (id: string) => void;
}) {
  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const c = list.data?.counts;
  const rows = list.data?.items ?? [];
  const TABS: Array<[string, string, number | undefined]> = [
    ['PENDING', '심사 대기', c?.pending], ['VERIFIED', '인증 완료', c?.verified],
    ['REJECTED', '반려', c?.rejected], ['EXPIRED', '기한 만료', c?.expired], ['ALL', '전체', undefined],
  ];
  return (
    <>
      <h2>중개사 인증 심사 <em>{c?.pending ?? ''}</em></h2>
      <p className="lead">사이트 「중개사 인증」(/my/broker) 신청입니다. <b>승인하면 그 사업자의 부동산 매물 공개가 열립니다.</b></p>
      {list.data?.assumed && (
        <p className="card warn">
          <b>국토부 연동 전이라 대조를 건너뛴 신청입니다(assume.broker).</b> &ldquo;일치&rdquo;는 실제 대조 결과가 아닙니다 —
          등록번호 · 상호 · 대표자를 국가공간정보포털에서 직접 확인한 뒤 승인하십시오.
        </p>
      )}
      <div className="acts">
        {TABS.map(([k, l, nn]) => (
          <button key={k} className={state === k ? 'btn-ok' : 'btn-plain'} onClick={() => onState(k)}>
            {l}{nn !== undefined ? ` ${nn}` : ''}
          </button>
        ))}
      </div>
      {/* v10.27 (G-207) — 찾기 · 순서 · 쪽 */}
      <form className="acts" data-broker-find onSubmit={(e) => { e.preventDefault(); onQ(String(new FormData(e.currentTarget).get('q') ?? '').trim()); }}>
        <input name="q" defaultValue={q} placeholder="상호 · 사무소 · 대표 · 이메일 · 사업자번호 · 등록번호" aria-label="중개사 신청 찾기" style={{ minWidth: 300 }} />
        <button className="btn-plain" type="submit">찾기</button>
        {q && <button className="btn-plain" type="button" onClick={() => onQ('')}>찾기 지우기</button>}
        <select aria-label="순서" value={order || (state === 'PENDING' ? 'old' : 'recent')} onChange={(e) => onOrder(e.target.value)}>
          <option value="old">오래된 순(먼저 온 신청부터)</option>
          <option value="recent">최근 순</option>
        </select>
        {list.data?.total != null && <span className="muted" data-broker-total={list.data.total}>{list.data.total.toLocaleString('ko-KR')}건 · {list.data.page}/{list.data.pages}쪽</span>}
      </form>
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && rows.length === 0 && <p className="muted">해당하는 중개사 인증 신청이 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>사업자</th><th>등록번호 · 사무소</th><th>대표자</th><th>국토부 대조</th><th>상태</th><th>접수</th><th></th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} data-broker={b.id}>
                <td><b>{b.company}</b><span className="muted"> {b.accountEmail}</span></td>
                <td><span className="mono">{b.licenseNo}</span><br /><span className="muted">{b.officeName ?? '—'}</span></td>
                <td>{b.ceoName ?? '—'}{!b.ceoMatch && <><br /><span className="warn-text">사업자 대표({b.bizCeoName})와 다름</span></>}</td>
                <td>{lookupView(b)}</td>
                <td>{BST[b.state] ?? b.state}{b.rejectReason ? <><br /><span className="muted">{b.rejectReason}</span></> : null}</td>
                <td className="muted">{ymdhm(b.createdAt)}</td>
                <td>
                  <button className="btn-sm" onClick={() => onOpen(b.id)}>보기</button>{' '}
                  {(b.state === 'PENDING' || b.state === 'SUBMITTED') && (
                    <>
                      <button className="btn-sm" disabled={busy === b.id || b.lookupResult !== 'MATCH'}
                              onClick={() => onDecide(b, 'VERIFIED')}>승인</button>{' '}
                      <button className="btn-no" disabled={busy === b.id} onClick={() => onDecide(b, 'REJECTED')}>반려</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(list.data?.pages ?? 1) > 1 && (
        <div className="acts" data-broker-pages>
          <button className="btn-plain" disabled={(list.data?.page ?? 1) <= 1} onClick={() => onPage((list.data?.page ?? 1) - 1)}>← 앞 쪽</button>
          <span className="muted">{list.data?.page} / {list.data?.pages}</span>
          <button className="btn-plain" disabled={(list.data?.page ?? 1) >= (list.data?.pages ?? 1)} onClick={() => onPage((list.data?.page ?? 1) + 1)}>다음 쪽 →</button>
        </div>
      )}
      <p className="card">
        <b>대조가 맞아도 자동 승인은 없습니다</b> — 명의 도용은 번호 대조로 거를 수 없어 사람이 봅니다.
        국토부 대조가 &ldquo;일치&rdquo;가 아니면 DB 가 승인을 막고, 반려에는 사유가 필요합니다. 승인되면 180일 뒤 재확인 기한이 붙습니다.
      </p>
      <p className="card">
        규제 분야 자격(qualification_reviews)의 중개사 항목은 「규제 자격 심사 (T-21)」 탭에서 그대로 처리합니다.
      </p>
    </>
  );
}

/* ── SB-ADM-BRK-011 중개사 인증 상세 ─────────────────────────────── */
/* v10.32 — GET /admin/brokers/:id/evidence (보증 · 서류 · 읽기 전용) */
interface BrokerEvidence { org: string | null; certNo: string | null; amount: number | null; from: string | null; until: string | null; docs: string[]; files: number; valid: boolean }
const BR_DOC: Record<string, string> = { REG_CERT: '중개사무소 등록증', GUARANTEE: '보증(공제) 증서', LICENSE: '공인중개사 자격증', ETC: '그 밖의 서류' };
/* 시안 K.rejects — 자동(BR01 · BR02 · BR05)은 대조가 거르므로 사람이 누르지 않습니다 */
const BR_REJ: Array<[string, string, boolean]> = [
  ['BR01', '국토교통부 자료에서 해당 등록번호를 찾지 못했습니다', true],
  ['BR02', '등록 상태가 영업이 아닙니다(휴업 · 폐업 · 등록취소)', true],
  ['BR03', '제출 서류가 등록번호 · 상호 · 대표자와 맞지 않습니다', false],
  ['BR04', '보증(공제) 증서가 없거나 기간이 지났습니다', false],
  ['BR05', '이미 다른 사업자가 같은 등록번호로 인증되어 있습니다', true],
  ['BR06', '기타 — 사유를 직접 적습니다', false],
];
const eok = (v: number) => (v >= 100000000 && v % 100000000 === 0 ? `${v / 100000000}억 원` : `${v.toLocaleString('ko-KR')}원`);

/* v10.32 — 시안(scAdmBrkD) 배치: 세 칸(신청 · 국토부 자료 · 보증 · 서류) → 승인 + 안내 → 반려 사유 코드 단추 → 심사 목록으로 */
function BrokerDetail({ id, busy, version, configured, onLookup, onDecide, onBack }: {
  id: string | null; busy: boolean; version: unknown;
  configured: boolean; onLookup: (b: Broker) => void;
  onDecide: (b: Broker, s: 'VERIFIED' | 'REJECTED', preset?: string) => void; onBack: () => void;
}) {
  const [b, setB] = useState<Broker | null>(null);
  const [ev, setEv] = useState<BrokerEvidence | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (!id) return;
    api<Broker>(`/admin/brokers/${id}`).then((r) => { setB(r); setErr(null); }).catch(setErr);
    api<BrokerEvidence>(`/admin/brokers/${id}/evidence`).then(setEv).catch(() => setEv(null));
  }, [id, version]);

  if (!id) {
    return (
      <>
        <p className="muted">선택된 신청이 없습니다. 목록에서 신청을 골라 주십시오.</p>
        <button className="btn-ok" onClick={onBack}>심사 목록으로</button>
      </>
    );
  }
  if (err) return <ErrorView error={err} onRetry={onBack} />;
  if (!b) return <p className="muted">불러오는 중…</p>;
  const open = b.state === 'PENDING' || b.state === 'SUBMITTED';
  const why = b.lookupResult !== 'MATCH' ? '국토부 대조가 일치하지 않았습니다 — DB 가 승인을 막습니다' : null;
  const stKind = b.state === 'VERIFIED' ? 'ok' : b.state === 'REJECTED' || b.state === 'EXPIRED' ? 'no' : 'wait';
  return (
    <>
      {/* 제목은 위 제목 줄(SUB_PAGE 'quals/detail') */}
      <p className="dim" style={{ margin: '-4px 0 10px' }}>신청 {b.id.slice(0, 8)}</p>
      <div className="ad-brk3" data-brk-detail={b.id}>
        <div className="ad-brkbox"><span className="lb">신청</span>
          <dl>
            <dt>사업자</dt><dd>{b.company}</dd>
            <dt>사업자번호</dt><dd>{b.personal ? <>개인 신청 <span className="dim">(사업자 아님 · 본인인증 회원 — v10.38 P2P)</span></> : <>{b.bizRegNo} <span className="dim">{b.bizVerified ? '사업자 인증' : '사업자 미인증'}{b.ntsStatus ? ` · 국세청 ${b.ntsStatus}` : ''}</span></>}</dd>
            <dt>등록번호</dt><dd className="mono">{b.licenseNo}</dd>
            <dt>계정</dt><dd>{b.accountEmail}</dd>
            <dt>접수</dt><dd>{ymdhm(b.createdAt)}</dd>
            <dt>상태</dt><dd><span className={`ad-bg ${stKind}`}>{BST[b.state] ?? b.state}</span>{b.canPublish ? <span className="dim"> 부동산 매물 공개 가능</span> : null}</dd>
            {b.decidedAt && <><dt>판정</dt><dd>{ymdhm(b.decidedAt)} · {b.decidedBy ?? '—'}</dd></>}
            {b.recheckDue && <><dt>재확인 기한</dt><dd>{ymdKst(b.recheckDue)}</dd></>}
          </dl>
        </div>
        <div className="ad-brkbox"><span className="lb">국토부 자료 {b.lookupAt ? `(${ymdKst(b.lookupAt)} 기준)` : '(미조회)'}</span>
          <dl>
            <dt>상호</dt><dd>{b.officeName ?? '—'}</dd>
            <dt>대표자</dt><dd>{b.ceoName ?? '—'} {b.ceoMatch ? <span className="st ok">사업자 대표와 일치</span>
              : <span className="warn-text">사업자 대표({b.bizCeoName})와 다름 — 명의 도용을 먼저 의심하십시오</span>}</dd>
            <dt>소재지</dt><dd>{[b.sido, b.sigungu].filter(Boolean).join(' ') || '—'}</dd>
            <dt>대조</dt><dd>{lookupView(b)}
              {b.lookupSource === 'API' ? <span className="dim"> 국토부 실제 조회</span>
                : b.lookupSource === 'ASSUMED' || (!b.lookupSource && b.assumed)
                  ? <span className="warn-text"> 간주 모드 — 실제 대조 아님</span> : null}
              {b.lookupDetail ? <><br /><span className="dim">{b.lookupDetail}</span></> : null}</dd>
            <dt>부동산 매물</dt><dd>공개 {b.malPublished}건 · 공개 대기 {b.malWaiting}건</dd>
          </dl>
        </div>
        <div className="ad-brkbox" data-brk-evidence><span className="lb">보증 · 서류</span>
          {ev && ev.org ? (
            <dl>
              <dt>기관</dt><dd>{ev.org}{ev.certNo ? <span className="dim"> {ev.certNo}</span> : null}</dd>
              <dt>금액</dt><dd>{ev.amount != null ? eok(ev.amount) : '—'}{ev.amount != null && ev.amount < 200000000 && <b className="warn-text"> 법정 최저 미만</b>}</dd>
              <dt>기간</dt><dd>{ev.from ?? '—'} ~ {ev.until ?? '—'}{!ev.valid && <b className="warn-text"> 기간 지남</b>}</dd>
            </dl>
          ) : <p className="dim" style={{ margin: 0 }}>신청 때 받은 보증(공제) 정보가 없습니다.</p>}
          <div className="docs">
            {ev && ev.docs.length ? ev.docs.map((d) => <span key={d} className="ad-bg">{BR_DOC[d] ?? d}</span>)
              : <span className="dim">제출된 서류가 없습니다</span>}
            {ev && ev.files > 0 && <span className="dim">첨부 {ev.files}개</span>}
          </div>
        </div>
      </div>
      {b.rejectReason && <div className="ad-nt warn"><b>반려 사유</b> — {b.rejectReason}</div>}
      {open && why && <div className="ad-nt warn"><b>지금은 승인할 수 없습니다.</b> {why}</div>}
      {open ? (
        <>
          <div className="ad-brkact">
            <button className="btn-ok" disabled={!!why || busy} onClick={() => onDecide(b, 'VERIFIED')}>승인</button>
            <button className="btn-sm" disabled={busy || !configured} onClick={() => onLookup(b)}
                    title={configured ? '국토부 중개사무소 조회와 다시 맞춰 봅니다' : '조회 연동(BROKER_LOOKUP_URL · KEY)이 설정되지 않았습니다'}>
              국토부 다시 조회</button>
            <span className="dim">반려에는 사유가 반드시 있어야 합니다 — 아래 사유를 누르면 글이 채워지고, 신청자에게 그대로 보입니다</span>
          </div>
          <div className="ad-brkrj" data-brk-reject>
            {BR_REJ.map(([code, text, auto]) => (
              <button key={code} disabled={busy || auto} title={auto ? '자동 판정 전용 코드입니다 — 신청 때 대조가 거릅니다' : undefined}
                      onClick={() => onDecide(b, 'REJECTED', code === 'BR06' ? 'BR06 · ' : `${code} · ${text}`)}>
                <b>{code}</b><span>{text}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="dim">심사 대기 상태가 아니라 승인 · 반려 칸이 없습니다 (현재 {BST[b.state] ?? b.state}).</p>
      )}
      <div className="ad-nt warn">
        <b>보증(공제) 금액은 막지 않고 알려만 줍니다.</b> 법인 4억 · 분사무소마다 2억 · 개인 2억이지만
        분사무소 수를 서버가 모릅니다. 미달이면 판단은 검수자가 합니다.
      </div>
      <div className="ad-dact"><button className="btn-plain" onClick={onBack}>심사 목록으로</button></div>
    </>
  );
}

/* ── SB-ADM-PTN-060 카테고리 마스터 (T-05 · T-06) ─────────────────────
 * v10.32 — 시안(admptnc) 순서 · 모양대로 위에 세 구역을 실제 자료로 둡니다(GET /admin/qualifications/category-master · 읽기 전용).
 *   ① 안심소개 상담 축 업종 — N종 ② 등록 폼 · 단가 (기존 카테고리) ③ 매트릭스 축
 * 그 아래 개발에만 있던 「규제 분야 기준 · 매물 심사」는 그대로 둡니다(10/10 답: 개발에만 있는 것은 남김). */
const CSL_STATE: Record<CatMaster['consult'][number]['state'], [string, string]> = {
  OPEN: ['ok', '공개'], LISTING_FEE: ['ok', '월 정액 노출형'], PENDING: ['wait', '준비 중'], INACTIVE: ['', '비활성'],
};
const won = (v: number) => `${v.toLocaleString('ko-KR')}원`;

function CategoryMaster() {
  const m = useApi<CatMaster>('/admin/qualifications/category-master');
  if (m.error) return <ErrorView error={m.error} onRetry={m.reload} />;
  if (!m.data) return <p className="muted">불러오는 중…</p>;
  const { consult, forms, matrices } = m.data;
  const live = consult.filter((c) => c.state !== 'INACTIVE');
  const off = consult.length - live.length;
  return (
    <div data-cat-master>
      <h3 className="ad-s2" data-cm="consult">안심소개 상담 축 업종 — {live.length}종{off ? <small className="muted" style={{ fontWeight: 500 }}> · 비활성 {off}</small> : null}</h3>
      {consult.length === 0 ? <p className="ad-empty">안심소개 상담 축 업종이 없습니다.</p> : (
        <div className="ad-tw"><table className="tbl">
          <thead><tr><th>코드</th><th>업종</th><th>게시 방식</th><th>상태</th></tr></thead>
          <tbody>
            {consult.map((c) => {
              const [cls, label] = CSL_STATE[c.state];
              return (
                <tr key={c.code} data-csl={c.code}>
                  <td><span className="mono">{c.code}</span></td>
                  <td><b>{c.name}</b></td>
                  <td>{c.publishMode === 'GATED'
                    ? <span className="ad-bg wait" title={c.legalBasis ?? undefined}>자격 확인 (GATED)</span>
                    : <span className="ad-bg ok">일반</span>}</td>
                  <td><span className={`ad-bg ${cls}`}>{label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      <div className="ad-nt info"><b>업종 삭제는 비활성으로만 합니다.</b> 진행 중인 상담 신청이나 활동 중인 인증업체가 있으면 막힙니다. 게시 방식(GATED ↔ 일반) 변경은 법무 승인이 필요하고, 보험 · 의료는 일반으로 바꿀 수 없습니다.</div>

      <h3 className="ad-s2" data-cm="forms">등록 폼 · 단가 (기존 카테고리)</h3>
      {forms.length === 0 ? <p className="ad-empty">등록 폼이 걸린 카테고리가 없습니다.</p> : (
        <div className="ad-tw"><table className="tbl">
          <thead><tr><th>카테고리</th><th>등록 폼</th><th>단계</th><th>견적 축</th><th>규제</th><th>단가 입력</th></tr></thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.code} data-form-cat={f.code} title={f.baseFee != null ? `기준 단가 ${won(f.baseFee)} · 노출 중 서비스 ${f.services}개` : undefined}>
                <td><b>{f.name}</b></td>
                <td>{f.formLabel ?? <span className="warn-text">미지정</span>}</td>
                <td>{f.steps ? `${f.steps}단계` : <span className="muted">—</span>}</td>
                <td>{f.axis ? `${f.axis.rows} × ${f.axis.cols} 구간` : f.blocked === 'NO_AXES' ? <span className="warn-text">구간 미정</span> : <span className="muted">—</span>}</td>
                <td>{f.regulation ? <span className="ad-bg wait">{f.regulation}</span> : <span className="muted">—</span>}</td>
                <td>{f.priceInput ? <span className="ad-bg ok">가능</span> : <span className="ad-bg no">막힘</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <div className="ad-nt warn"><b>폼 유형이 지정되지 않은 카테고리는 단가 입력 자체가 막힙니다.</b> 등록 폼은 업종 마스터(categories.service_form)에 있고 DB 가 막습니다 — 파트너센터 등록 화면도 이 값을 그대로 씁니다.</div>

      {matrices.length === 0 ? (
        <>
          <h3 className="ad-s2" data-cm="matrix">매트릭스 축</h3>
          <p className="ad-empty">매트릭스 견적 업종에 구간이 없습니다.</p>
        </>
      ) : matrices.map((x) => (
        <div key={x.code} data-matrix={x.code}>
          <h3 className="ad-s2" data-cm="matrix">매트릭스 축 — {x.name} {x.rows.length}×{x.cols.length}</h3>
          <div className="ad-tw"><table className="tbl">
            <thead><tr><th>구간</th>{x.cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {x.rows.map((r) => (
                <tr key={r.key}><td><b>{r.label}</b></td>{x.cols.map((c) => <td key={c.key} className="muted">—</td>)}</tr>
              ))}
            </tbody>
          </table></div>
        </div>
      ))}
      <div className="ad-nt warn"><b>기준 금액은 아직 없습니다.</b> 축(구간)은 업종 마스터(category_matrix_axes)에 있고, 파트너가 넣는 견적 값은 이 구간만 받습니다(DB 가 막습니다). 칸마다 금액은 파트너가 서비스마다 넣습니다 — 업종 마스터에 기준 금액 칸이 생기면 여기에 보입니다.</div>
    </div>
  );
}

function Categories() {
  const rules = useApi<Rule[]>('/admin/qualifications/rules');
  const props = useApi<Property[]>('/admin/qualifications/properties');
  const a = useAct();

  async function decideProp(listingId: string, approve: boolean) {
    const reason = approve ? undefined : prompt('반려 사유 — 무엇이 부족한지까지 적어 주십시오') ?? '';
    if (!approve && !reason?.trim()) return;
    await a.run(listingId, () => api(`/admin/qualifications/properties/${listingId}/decide`, {
      method: 'POST', body: JSON.stringify({ approve, reason }),
    }), props.reload, approve ? '매물을 공개했습니다.' : '반려했습니다.');
  }

  if (rules.error) return <ErrorView error={rules.error} onRetry={rules.reload} />;

  return (
    <>
      {/* v10.32 — 제목 · 설명은 위 제목 줄(SUB_PAGE 'quals/cats') */}
      <CategoryMaster />

      <h2>규제 분야 기준 <em>{(rules.data ?? []).length}</em></h2>
      <p className="lead">카테고리가 필요한 자격을 정합니다 — 자격 심사(T-21)의 기준입니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl">
        <thead><tr><th>분야</th><th>필요 서류</th><th>근거</th><th>발급처 조회</th><th>대기</th></tr></thead>
        <tbody>
          {(rules.data ?? []).map((r) => (
            <tr key={r.categoryCode}>
              <td><b>{r.categoryName}</b> <span className="mono">{r.categoryCode}</span></td>
              <td className="muted">{r.requiredDoc}</td>
              <td className="muted">{r.legalBasis.includes('불가') ? <b className="warn-text">{r.legalBasis}</b> : r.legalBasis}</td>
              <td>{r.needsLookup ? '필수' : '—'}</td>
              <td className="num-cell">{r.pending}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card warn">
        <b>대부 · 다단계는 심사 대상이 아니라 등록 금지입니다.</b> 승인하려 해도 DB 가 막습니다.
      </p>

      <h2>매물 심사 <em>{(props.data ?? []).length}</em></h2>
      <p className="card warn">
        <b>자격 없는 사람이 매물을 올리고 중개하면 무등록 중개입니다.</b> 개설등록번호와 자격 심사 통과가
        모두 있어야 공개됩니다 — DB 가 막습니다.
      </p>
      {props.error ? <ErrorView error={props.error} onRetry={props.reload} /> : null}
      {props.data && props.data.length === 0 && <p className="muted">심사 대기 중인 매물이 없습니다.</p>}
      {(props.data ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>매물</th><th>중개사</th><th>등록번호</th><th>지역</th><th>자격</th><th>처리</th></tr></thead>
          <tbody>
            {(props.data ?? []).map((p) => (
              <tr key={p.listingId}>
                <td><b>{p.title}</b></td>
                <td className="muted">{p.company ?? '—'}</td>
                <td className="muted">{p.brokerRegNo ?? <span className="warn-text">미제출</span>}</td>
                <td className="muted">{[p.sido, p.sigungu].filter(Boolean).join(' ')}</td>
                <td>{p.brokerOk ? <span className="badge badge-verified">통과</span> : <span className="badge badge-urgent">미통과</span>}</td>
                <td>
                  <button className="btn-sm" disabled={!p.brokerOk || !p.brokerRegNo || a.busy === p.listingId}
                          onClick={() => void decideProp(p.listingId, true)}>공개</button>{' '}
                  <button className="btn-no" disabled={a.busy === p.listingId}
                          onClick={() => void decideProp(p.listingId, false)}>반려</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card">
        <b>매물 주소는 시 · 군 · 구까지만 받습니다.</b> 상세주소는 그 자체로 특정 건물을 가리키고,
        공개 전 매물의 위치가 새면 분쟁이 됩니다.
      </p>
    </>
  );
}

/* ── SB-ADM-PTN-040 의료 심의 ────────────────────────────────────── */
/* v10.32 — 시안(scAdmPtnMed) 배치: 위 노란 사전심의 띠 → 소재 카드(제목 · 번호 · 광고주 · 분야 / 심의 번호 · 근거 법 칩 · 단계 / 승인 대기 · 단추) → 노란 띠.
 * 「심의필 확인」은 광고 탭과 같은 서버 호출(POST /admin/ad-creatives/:code/review-confirm)입니다.
 * v10.32 — 시안 「반려」 단추: POST /admin/ad-creatives/:code/review-reject(사유 필수 · 감사 기록 · ADMIN · SUPER · D091).
 *   개발에만 있던 「광고 소재 보기」(광고 탭으로)는 카드 안 단계 줄 옆 작은 단추로 남깁니다(시안 단추 자리 = 반려 · 심의필 확인). */
const MED_LAW: Record<string, string> = { 의료: '의료법 제27조 · 제56조' };
function MedicalView({ onGo }: { onGo?: (tab: string) => void }) {
  const medical = useApi<Medical[]>('/admin/qualifications/medical');
  const creatives = useApi<Array<{ code: string; title?: string }>>('/admin/ad-creatives');
  const a = useAct();
  if (medical.error) return <ErrorView error={medical.error} onRetry={medical.reload} />;
  const med = medical.data ?? [];
  const title = (code: string) => (creatives.data ?? []).find((c) => c.code === code)?.title;
  function confirmReview(code: string) {
    const reviewNo = prompt(`${code} 의 심의필 번호 — 발급처에서 조회한 번호를 적어 주십시오`) ?? '';
    if (!reviewNo.trim()) return;
    void a.run(code, () => api(`/admin/ad-creatives/${code}/review-confirm`, {
      method: 'POST', body: JSON.stringify({ reviewNo: reviewNo.trim() }),
    }), medical.reload, '심의필을 확인했습니다. 이제 슬롯에 배정할 수 있습니다.');
  }
  function rejectReview(code: string) {
    const reason = prompt(`${code} 반려 사유 — 무엇이 맞지 않았는지까지 적어 주십시오 (감사 기록에 남습니다)`) ?? '';
    if (reason.trim().length < 2) { if (reason) alert('반려 사유를 두 글자 이상 적어 주십시오.'); return; }
    void a.run(code, () => api(`/admin/ad-creatives/${code}/review-reject`, {
      method: 'POST', body: JSON.stringify({ reason: reason.trim() }),
    }), medical.reload, '반려했습니다. 이 소재는 심의 대기에서 빠지고 슬롯에 배정되지 않습니다.');
  }
  return (
    <>
      {/* 제목 · 설명은 위 제목 줄(SUB_PAGE 'quals/medical') */}
      <div className="ad-nt warn"><b>의료광고는 사전심의 대상입니다. 본사가 심의필을 확인해야 광고 가능으로 넘어갑니다</b> — 확인 전에는 어떤 슬롯에도 배정되지 않습니다(DB 가 막습니다).</div>
      <Flash msg={a.msg} err={a.err} />
      {medical.data && med.length === 0 && <p className="ad-empty">심의 확인 대기 소재가 없습니다.</p>}
      {med.map((m) => (
        <div key={m.creativeCode} className="ad-mrow" data-med={m.creativeCode}>
          <div className="mt">
            <b>{title(m.creativeCode) || `${m.advertiser} 광고 소재`}</b>
            <span className="ls">{m.creativeCode} · {m.advertiser} · {m.category}</span>
            <div className="lh">
              <span className={`ad-chip${m.reviewNo ? '' : ' no'}`}>{m.reviewNo ? `심의 ${m.reviewNo}` : '심의필 미제출'}</span>
              <span className="ad-chip warn">{MED_LAW[m.category] ?? '사전심의 대상'}</span>
            </div>
            <span className="ls">{m.reviewNo ? '심의필 등록 완료 → 본사 확인 대기' : '심의필 번호를 받아 발급처에서 조회한 뒤 확인합니다'}
              {onGo && <> · <button type="button" className="ad-inl" data-act="med-open-ads" onClick={() => onGo('ads')}>광고 소재 보기</button></>}</span>
          </div>
          <div className="mm"><span className="ad-bg wait">승인 대기</span></div>
          <div className="mact">
            <button className="btn-sm" data-act="med-reject" disabled={a.busy === m.creativeCode} onClick={() => rejectReview(m.creativeCode)}>반려</button>
            <button className="btn-ok btn-sm" disabled={a.busy === m.creativeCode} onClick={() => confirmReview(m.creativeCode)}>심의필 확인</button>
          </div>
        </div>
      ))}
      <div className="ad-nt warn">
        <b>번호만 받지 말고 실제 조회하십시오.</b> 의료법 제27조 · 제56조는 과태료 대상이고, 환자 유인 · 알선으로
        보이면 더 무겁습니다. 의료 광고는 심의필 없이 나가면 안 됩니다.
      </div>
    </>
  );
}
