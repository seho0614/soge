import { Fragment, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymd } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { siteHref } from '../../lib/siteUrl';
import { withUpload, openFile, guessType, fmtSize, TYPE_LABEL } from '../../lib/files';

interface AppRow {
  id: string; grade: string; status: string; appliedAt: string;
  companyName: string; ceoName: string; bizRegNo: string | null; bizVerified: boolean; personal?: boolean; actorOk?: boolean;
}
interface Product {
  id: string; code: string; name: string; advertiser: string | null; commission: number | string;
  status: string; landingUrl: string; orders: number; rateChanges: number; updatedAt: string;
}
interface Goal {
  id: string; partnerId: string | null; grade: string | null; periodYm: string;
  target: number | string; reward: number | string | null; scope: string; companyName: string | null;
}
interface FileRef { fileId: string | null; fileName: string | null; fileType: string | null; fileSize: number | string | null; fileKey?: string | null }
interface Material extends FileRef { id: string; title: string; kind: string; body: string | null; createdAt: string; createdBy: string }
interface Guide extends FileRef { id: string; title: string; body: string; sortOrder: number; isActive: boolean; updatedAt: string }
interface Settle {
  id: string; track: string; from: string; to: string; gross: number | string; net: number | string;
  state: string; companyName: string; accountReady: boolean;
}
interface Partner { id: string; company: string; grade: string; status: string }

const PST: Record<string, string> = { DRAFT: '초안', ON_SALE: '판매중', SOLD_OUT: '품절', STOPPED: '중단' };
const SST: Record<string, string> = { DRAFT: '확정 대기', CONFIRMED: '확정', PAID: '지급', HELD: '보류' };
const TRACK: Record<string, string> = { AFFILIATE: '제휴수수료', REFERRAL: '소개비' };

type View = 'apply' | 'products' | 'goals' | 'materials' | 'settle';
const TABS: SubTab<View>[] = [
  { key: 'apply', label: '입점 심사', screen: 'SB-AFF-APL-010' },
  { key: 'products', label: '제휴상품 · 단가', screen: 'SB-AFF-PRD-010' },
  { key: 'goals', label: '목표 설정', screen: 'SB-AFF-GOL-010' },
  { key: 'materials', label: '마케팅자료 · 가이드', screen: 'SB-AFF-MTR-010' },
  { key: 'settle', label: '트랙별 정산', screen: 'SB-AFF-STL-010' },
];

/**
 * SB-AFF-APL-010 파트너 입점 심사
 * SB-AFF-PRD-010 제휴상품 · 단가
 * SB-AFF-GOL-010 목표 설정 · 지급
 * SB-AFF-MTR-010 마케팅자료 심의 · 등록 · 파트너가이드 등록 (D007 — 파일 올리기)
 * SB-AFF-STL-010 트랙별 정산 배치
 *
 * 파트너는 제휴상품 링크를 뿌리고 **건당 정액 수수료**를 받습니다.
 * 소개비(당사자끼리 직접 · 플랫폼 공제 0원, INV-9)와 달리 제휴수수료는
 * **회사가 파트너에게 지급하는 마케팅비**입니다. 화면에 늘 병기합니다.
 */
export function Affiliates({ onGo }: { onGo?: (tab: string) => void }) {
  const [view, setView] = useState<View>('apply');
  return (
    <section>
      <SubTabs tabs={TABS} value={view} onChange={setView} />
      {/* v10.31 — 시안 「파트너가 보는 화면 열기」(사용자 웹 제휴 파트너스 화면 · 새 창) */}
      <div className="ad-dact end" style={{ marginTop: 0 }}>
        <a className="btn-plain btn-sm" href={siteHref('/partners')} target="_blank" rel="noreferrer" data-open-partner-view>파트너가 보는 화면 열기</a>
      </div>
      <p className="hint"><b>제휴수수료는 회사가 파트너에게 주는 마케팅비입니다.</b> 소개비(당사자끼리 직접 · 공제 0원)와 섞지 않습니다.</p>
      {view === 'apply' && <Applications />}
      {view === 'products' && <Products />}
      {view === 'goals' && <Goals />}
      {view === 'materials' && <><Materials /><Guides /></>}
      {view === 'settle' && <Settlements onGo={onGo} />}
    </section>
  );
}

/* ── SB-AFF-APL-010 ──────────────────────────────────────────────── */
function Applications() {
  const r = useApi<{ items: AppRow[]; note: string | null }>('/admin/affiliates/applications');
  const a = useAct();
  const decide = (x: AppRow, ok: boolean) => {
    const reason = ok ? undefined : prompt('거절 사유 — 안 적으면 같은 신청이 다시 올라옵니다') ?? '';
    if (!ok && (!reason || reason.trim().length < 2)) { a.setErr('거절하실 때는 사유를 적으십시오.'); return; }
    void a.run(x.id, () => api(`/admin/affiliates/applications/${x.id}/decide`, {
      method: 'POST', body: JSON.stringify({ state: ok ? 'APPROVED' : 'REJECTED', reason: reason?.trim() }),
    }), r.reload);
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const rows = r.data.items;
  return (
    <>
      <h2>파트너 입점 심사 <em>{rows.length}</em></h2>
      <p className="lead">관리자가 승인해야 링크를 발급할 수 있습니다.</p>
      <p className="card warn"><b>사업자 인증이 끝난 곳인지 먼저 보십시오.</b> 인증 안 된 곳을 승인하면 정산할 때 세금계산서를 받을 수 없습니다.</p>
      {r.data.note && <p className="card">{r.data.note}</p>}
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">심사를 기다리는 신청이 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>상호</th><th>대표</th><th>사업자</th><th>인증</th><th>신청일</th><th>처리</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td><b>{x.companyName}</b></td><td>{x.ceoName}</td><td className="muted">{x.personal ? '개인' : x.bizRegNo}</td>
                <td>{(x.actorOk ?? x.bizVerified) ? <span className="st ok">{x.personal ? '본인인증' : '완료'}</span> : <span className="st no">미인증</span>}</td>
                <td className="muted">{ymd(x.appliedAt)}</td>
                <td>
                  {/* v10.38 (D096 · P2P) — 사업자는 사업자 인증, 개인은 본인인증이면 승인합니다 */}
                  {(x.actorOk ?? x.bizVerified)
                    ? <button className="btn-sm" disabled={a.busy === x.id} onClick={() => decide(x, true)}>승인</button>
                    : <span className="st no">{x.personal ? '본인인증 먼저' : '사업자 인증 먼저'}</span>}{' '}
                  <button className="btn-no" disabled={a.busy === x.id} onClick={() => decide(x, false)}>거절</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card"><b>거절하실 때는 사유를 적으십시오.</b> 안 적으면 같은 신청이 다시 올라옵니다.</p>
    </>
  );
}

/* ── SB-AFF-PRD-010 ──────────────────────────────────────────────── */
function Products() {
  const r = useApi<Product[]>('/admin/affiliates/products');
  const [f, setF] = useState({ code: '', name: '', commission: '', landingUrl: '', advertiser: '' });
  const [rate, setRate] = useState<Record<string, string>>({});
  const a = useAct();

  const create = () => {
    const commission = Number(f.commission);
    if (f.code.trim().length < 2 || f.name.trim().length < 2) { a.setErr('코드와 상품명을 두 자 이상 적으십시오.'); return; }
    if (!Number.isInteger(commission) || commission < 1) { a.setErr('건당 수수료는 1원 이상의 정수입니다.'); return; }
    if (f.landingUrl.trim().length < 8) { a.setErr('랜딩 주소를 적으십시오.'); return; }
    void a.run('new', () => api('/admin/affiliates/products', {
      method: 'POST',
      body: JSON.stringify({ code: f.code.trim(), name: f.name.trim(), commission, landingUrl: f.landingUrl.trim(),
        advertiser: f.advertiser.trim() || undefined }),
    }), () => { setF({ code: '', name: '', commission: '', landingUrl: '', advertiser: '' }); r.reload(); });
  };
  const patch = (p: Product, body: Record<string, unknown>) =>
    a.run(p.id, () => api(`/admin/affiliates/products/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      () => { setRate((x) => { const nx = { ...x }; delete nx[p.id]; return nx; }); r.reload(); });

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  return (
    <>
      <h2>제휴상품 · 단가 <em>{r.data.length}</em></h2>
      <p className="card warn">
        <b>단가를 바꿔도 이미 생긴 주문은 그대로입니다.</b> 주문이 생긴 시점의 단가로 고정되고, 새 주문부터
        새 단가가 적용됩니다 — 소급하면 이미 정산한 것이 흔들립니다.
      </p>
      <Flash msg={a.msg} err={a.err} />
      {r.data.length === 0 && <p className="muted">등록된 제휴상품이 없습니다.</p>}
      {r.data.length > 0 && (
        <table className="tbl">
          <thead><tr><th>상품</th><th>광고주</th><th>건당 수수료</th><th>주문</th><th>단가변경</th><th>상태</th></tr></thead>
          <tbody>
            {r.data.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b> <span className="mono">{p.code}</span></td>
                <td className="muted">{p.advertiser ?? '—'}</td>
                <td>
                  <input className="inp-sm" style={{ width: '7rem' }} type="number" min={1} aria-label={`${p.code} 수수료`}
                         value={rate[p.id] ?? String(p.commission)} onChange={(e) => setRate({ ...rate, [p.id]: e.target.value })} />
                  <button className="btn-sm" disabled={rate[p.id] === undefined || a.busy === p.id}
                          onClick={() => void patch(p, { commission: Number(rate[p.id]) })}>단가 저장</button>
                </td>
                <td className="num-cell">{n(p.orders)}</td>
                <td className="num-cell">{p.rateChanges}회</td>
                <td>
                  <select className="sel" style={{ marginBottom: 0 }} value={p.status} disabled={a.busy === p.id}
                          aria-label={`${p.code} 상태`} onChange={(e) => void patch(p, { status: e.target.value })}>
                    {Object.entries(PST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card"><b>등록하면 초안으로 들어갑니다.</b> 판매중으로 바꾸셔야 파트너에게 보입니다.</p>
      <p className="card warn"><b>재고 연동이 없습니다.</b> 광고주가 마감했으면 손으로 품절 · 중단으로 바꾸셔야 합니다 — 안 바꾸면 파트너가 계속 뿌립니다.</p>

      <h3 className="sec">상품 등록</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>코드</span><input value={f.code} placeholder="AP-002" onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <label><span>상품명</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label><span>건당 수수료(원)</span><input type="number" min={1} value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} /></label>
          <label><span>광고주</span><input value={f.advertiser} onChange={(e) => setF({ ...f, advertiser: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>랜딩 주소</span><input value={f.landingUrl} placeholder="https://" onChange={(e) => setF({ ...f, landingUrl: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'new'} onClick={create}>상품 등록</button></div>
        <p className="hint"><b>건당 정액입니다.</b> 비율이 아닌 것은 거래액을 우리가 못 보기 때문입니다.</p>
      </div>
    </>
  );
}

/* ── SB-AFF-GOL-010 ──────────────────────────────────────────────── */
function Goals() {
  const ymNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);   // 10/2 — 한국 기준 이번 달 (UTC 면 1일 0~9시에 지난달)
  const [ym, setYm] = useState('');
  const r = useApi<Goal[]>(ym ? `/admin/affiliates/goals?ym=${ym}` : '/admin/affiliates/goals');
  const partners = useApi<Partner[]>('/admin/partners');
  const [f, setF] = useState({ scope: 'grade', grade: 'A', partnerId: '', periodYm: ymNow, target: '', reward: '' });
  const a = useAct();

  const save = () => {
    const target = Number(f.target); const reward = f.reward ? Number(f.reward) : undefined;
    if (!/^\d{4}-\d{2}$/.test(f.periodYm)) { a.setErr('기간은 YYYY-MM 입니다.'); return; }
    if (!Number.isInteger(target) || target < 1) { a.setErr('목표 금액을 적으십시오.'); return; }
    if (f.scope === 'partner' && !f.partnerId) { a.setErr('파트너를 고르십시오.'); return; }
    void a.run('goal', () => api('/admin/affiliates/goals', {
      method: 'POST',
      body: JSON.stringify({
        periodYm: f.periodYm, target, reward,
        ...(f.scope === 'partner' ? { partnerId: f.partnerId } : { grade: f.grade.trim() }),
      }),
    }), () => { setF({ ...f, target: '', reward: '' }); r.reload(); });
  };

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data ?? [];
  return (
    <>
      <h2>목표 설정 · 지급 <em>{rows.length}</em></h2>
      <p className="card"><b>개인 목표가 등급 일괄보다 우선합니다.</b> 특별히 정해 준 것이 일반 규칙보다 앞섭니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <div className="search-row">
        <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} aria-label="기간" style={{ maxWidth: 200 }} />
        {ym && <button className="btn-plain" onClick={() => setYm('')}>전체 기간</button>}
      </div>
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">정한 목표가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>범위</th><th>대상</th><th>기간</th><th>목표</th><th>달성 시 지급</th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td>{g.scope === '개인' ? <span className="st ok">개인</span> : <span className="st">등급</span>}</td>
                <td>{g.companyName ?? g.grade}</td><td>{g.periodYm}</td>
                <td className="num-cell">{n(g.target)}원</td><td className="num-cell">{g.reward == null ? '—' : `${n(g.reward)}원`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">목표 설정</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>범위</span>
            <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="grade">등급 일괄</option><option value="partner">개인</option>
            </select>
          </label>
          {f.scope === 'grade'
            ? <label><span>등급</span><input value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} /></label>
            : <label><span>파트너</span>
                <select value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })}>
                  <option value="">고르십시오</option>
                  {(partners.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.company} ({p.grade})</option>)}
                </select>
              </label>}
          <label><span>기간 (YYYY-MM)</span><input value={f.periodYm} onChange={(e) => setF({ ...f, periodYm: e.target.value })} /></label>
          <label><span>목표 (원)</span><input type="number" min={1} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label><span>달성 시 지급 (원)</span><input type="number" min={0} value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'goal'} onClick={save}>목표 설정</button></div>
        <p className="hint">달성분 지급은 트랙별 정산에서 제휴수수료 트랙으로 나갑니다.</p>
      </div>
    </>
  );
}

/* ── SB-AFF-MTR-010 ──────────────────────────────────────────────── */
const KIND: Record<string, string> = { IMAGE: '이미지', BANNER: '배너', COPY: '문구', VIDEO: '영상', DOC: '문서' };
/** 형식별로 받는 파일 (DB fn_file_ref_material 과 같음 — 여기는 안내용) */
const KIND_TYPES: Record<string, string[]> = {
  IMAGE: ['image/jpeg', 'image/png'], BANNER: ['image/jpeg', 'image/png'], VIDEO: ['video/mp4'],
  DOC: ['application/pdf', 'image/jpeg', 'image/png'], COPY: [],
};
const KIND_ACCEPT: Record<string, string> = {
  IMAGE: '.jpg,.jpeg,.png', BANNER: '.jpg,.jpeg,.png', VIDEO: '.mp4', DOC: '.pdf,.jpg,.jpeg,.png', COPY: '',
};

/** 첨부 열기 버튼 — 5분짜리 주소를 받아 새 창으로 */
function FileCell({ f, onErr }: { f: FileRef; onErr: (m: string) => void }) {
  if (!f.fileId) return f.fileKey ? <span className="dim mono">{f.fileKey} (파일 없음)</span> : <span className="dim">—</span>;
  return (
    <>
      <button className="btn-sm" data-file-id={f.fileId}
              onClick={() => void openFile(f.fileId!).catch((e) => onErr(e instanceof Error ? e.message : '파일을 열지 못했습니다.'))}>파일 열기</button>
      <div className="dim">{f.fileName} · {TYPE_LABEL[f.fileType ?? ''] ?? ''} {fmtSize(f.fileSize)}</div>
    </>
  );
}

function Materials() {
  const r = useApi<{ items: Material[]; note: string | null }>('/admin/affiliates/materials/queue');
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ title: '', kind: 'BANNER', body: '' });
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const a = useAct();
  const review = (m: Material, ok: boolean) => {
    const reason = ok ? undefined : prompt('반려 사유 — 인앱과 이메일로 갑니다') ?? '';
    if (!ok && (!reason || reason.trim().length < 2)) { a.setErr('반려 사유를 적으십시오. 안 적으면 같은 자료가 다시 올라옵니다.'); return; }
    void a.run(m.id, () => api(`/admin/affiliates/materials/${m.id}/review`, {
      method: 'POST', body: JSON.stringify({ state: ok ? 'APPROVED' : 'REJECTED', reason: reason?.trim() }),
    }), r.reload);
  };
  const create = () => {
    if (f.title.trim().length < 2) { a.setErr('제목을 두 자 이상 적으십시오.'); return; }
    if (f.kind === 'COPY' && f.body.trim().length < 5) { a.setErr('문구 자료는 본문을 다섯 자 이상 적으십시오.'); return; }
    if (f.kind !== 'COPY' && !file) { a.setErr(`${KIND[f.kind]} 자료는 파일을 고르십시오.`); return; }
    if (file && !(KIND_TYPES[f.kind] ?? []).includes(guessType(file))) {
      a.setErr(`${KIND[f.kind]} 자료는 ${(KIND_TYPES[f.kind] ?? []).map((t) => TYPE_LABEL[t]).join(' · ')} 파일만 받습니다.`); return;
    }
    void a.run('mat-new', () => withUpload(file, 'MARKETING_MATERIAL', (fileId) => api('/admin/affiliates/materials', {
        method: 'POST',
        body: JSON.stringify({ title: f.title.trim(), kind: f.kind, body: f.body.trim() || undefined, fileId }),
      })), () => { setF({ title: '', kind: f.kind, body: '' }); setFile(null); setFileKey((k) => k + 1); r.reload(); });
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const rows = r.data.items;
  const risky = (t: string) => /무조건|100%|보장|확정 수익|원금/.test(t);
  return (
    <>
      <h2>마케팅자료 심의 <em>{rows.length}</em></h2>
      <p className="card warn">
        <b>파트너가 이것을 뿌립니다 — 회사가 한 말이 됩니다.</b> 과장 · 단정 표현이 있으면 표시광고법에 걸립니다.
        &ldquo;무조건&rdquo; &ldquo;100%&rdquo; &ldquo;보장&rdquo; 같은 말을 보십시오. <b>파일도 열어 보고</b> 판단하십시오.
      </p>
      {r.data.note && <p className="card">{r.data.note}</p>}
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">심의를 기다리는 자료가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>제목</th><th>형식</th><th>파일</th><th>올린이</th><th>등록일</th><th>처리</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <Fragment key={m.id}>
                <tr>
                  <td><button className="linkbtn" onClick={() => setOpen(open === m.id ? null : m.id)}>{m.title}</button>
                    {risky(m.title + (m.body ?? '')) && <span className="badge badge-urgent"> 단정 표현</span>}</td>
                  <td>{KIND[m.kind] ?? m.kind}</td>
                  <td><FileCell f={m} onErr={a.setErr} /></td>
                  <td>{m.createdBy}</td><td className="muted">{ymd(m.createdAt)}</td>
                  <td>
                    <button className="btn-sm" disabled={a.busy === m.id} onClick={() => review(m, true)}>승인</button>{' '}
                    <button className="btn-no" disabled={a.busy === m.id} onClick={() => review(m, false)}>반려</button>
                  </td>
                </tr>
                {open === m.id && <tr><td colSpan={6} className="muted" style={{ whiteSpace: 'pre-wrap' }}>{m.body ?? '(본문 없음)'}</td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      <p className="card"><b>반려하면 인앱과 이메일로 사유가 갑니다.</b> 사유를 안 적으면 같은 자료가 다시 올라옵니다.</p>

      <h3 className="sec">자료 등록</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>제목</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="자료 제목" /></label>
          <label><span>형식</span>
            <select value={f.kind} aria-label="자료 형식" onChange={(e) => { setF({ ...f, kind: e.target.value }); setFile(null); setFileKey((k) => k + 1); }}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {f.kind !== 'COPY' && (
            <label style={{ gridColumn: '1 / -1' }}><span>파일 ({(KIND_TYPES[f.kind] ?? []).map((t) => TYPE_LABEL[t]).join(' · ')})</span>
              <input key={fileKey} type="file" accept={KIND_ACCEPT[f.kind]} aria-label="자료 파일"
                     onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>)}
          <label style={{ gridColumn: '1 / -1' }}><span>문구 · 설명 {f.kind === 'COPY' ? '(필수)' : '(선택)'}</span>
            <textarea rows={3} value={f.body} aria-label="자료 문구" onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'mat-new'} onClick={create}>
          {a.busy === 'mat-new' ? '올리는 중…' : '심의 대기로 올리기'}</button></div>
        <p className="hint"><b>올리면 심의 대기로 들어갑니다.</b> 위 표에서 승인해야 파트너 자료실에 나갑니다.
          이미지 · 배너 10MB, PDF 20MB, 영상(MP4) 50MB 까지. 형식은 서버가 파일 내용으로 다시 판정합니다.</p>
      </div>
    </>
  );
}

/* ── 파트너가이드 (SB-AFF-MTR-010 안) ─────────────────────────────── */
function Guides() {
  const r = useApi<Guide[]>('/admin/affiliates/guides');
  const [f, setF] = useState({ title: '', body: '', sortOrder: '100' });
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const a = useAct();
  const create = () => {
    if (f.title.trim().length < 2) { a.setErr('가이드 제목을 두 자 이상 적으십시오.'); return; }
    if (f.body.trim().length < 5) { a.setErr('가이드 본문을 다섯 자 이상 적으십시오.'); return; }
    if (file && !['application/pdf', 'image/jpeg', 'image/png'].includes(guessType(file))) { a.setErr('첨부는 PDF · JPG · PNG 만 받습니다.'); return; }
    void a.run('guide-new', () => withUpload(file, 'PARTNER_GUIDE', (fileId) => api('/admin/affiliates/guides', {
        method: 'POST',
        body: JSON.stringify({ title: f.title.trim(), body: f.body.trim(), sortOrder: Number(f.sortOrder) || 0, fileId }),
      })), () => { setF({ title: '', body: '', sortOrder: '100' }); setFile(null); setFileKey((k) => k + 1); r.reload(); });
  };
  const toggle = (g: Guide) => a.run(g.id, () => api(`/admin/affiliates/guides/${g.id}`, {
    method: 'PATCH', body: JSON.stringify({ isActive: !g.isActive }) }), r.reload, g.isActive ? '껐습니다. 파트너에게 안 보입니다.' : '켰습니다.');

  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data ?? [];
  return (
    <>
      <h2>파트너가이드 <em>{rows.length}</em></h2>
      <p className="card">가이드는 심의 없이 <b>바로</b> 파트너가이드에 보입니다. 첨부는 <b>승인된(ACTIVE) 파트너만</b> 내려받습니다.</p>
      <Flash msg={a.msg} err={a.err} />
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">등록된 가이드가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>순서</th><th>제목</th><th>첨부</th><th>상태</th><th>수정일</th><th /></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td className="num-cell">{g.sortOrder}</td>
                <td><b>{g.title}</b></td>
                <td><FileCell f={g} onErr={a.setErr} /></td>
                <td>{g.isActive ? <span className="st ok">보임</span> : <span className="st no">꺼짐</span>}</td>
                <td className="muted">{ymd(g.updatedAt)}</td>
                <td><button className="btn-plain" disabled={a.busy === g.id} onClick={() => void toggle(g)}>{g.isActive ? '끄기' : '켜기'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="sec">가이드 등록</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>제목</span><input value={f.title} aria-label="가이드 제목" onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label><span>순서 (작을수록 위)</span><input type="number" min={0} value={f.sortOrder} aria-label="가이드 순서" onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>본문</span>
            <textarea rows={4} value={f.body} aria-label="가이드 본문" onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>첨부 (선택 · PDF · JPG · PNG)</span>
            <input key={fileKey} type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="가이드 첨부"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'guide-new'} onClick={create}>
          {a.busy === 'guide-new' ? '올리는 중…' : '가이드 올리기'}</button></div>
      </div>
    </>
  );
}

/* ── SB-AFF-STL-010 ──────────────────────────────────────────────── */
function Settlements({ onGo }: { onGo?: (tab: string) => void }) {
  const r = useApi<Settle[]>('/admin/affiliates/settlements');
  const [track, setTrack] = useState('AFFILIATE');
  /* v10.31 — 시안처럼 기간을 지난달로 채워 둡니다(바꿀 수 있음) */
  const lastMonth = (() => { const t = new Date(); const f = new Date(t.getFullYear(), t.getMonth() - 1, 1); const e = new Date(t.getFullYear(), t.getMonth(), 0);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [iso(f), iso(e)]; })();
  const [from, setFrom] = useState(lastMonth[0]!);
  const [to, setTo] = useState(lastMonth[1]!);
  const a = useAct();
  const run = () => {
    if (!from || !to || from > to) { a.setErr('기간을 바르게 고르십시오.'); return; }
    if (!confirm(`${TRACK[track]} 트랙 ${from} ~ ${to} 정산 배치를 실행합니다.`)) return;
    void a.run('run', () => api('/admin/affiliates/settlements/run', {
      method: 'POST', body: JSON.stringify({ track, periodFrom: from, periodTo: to }),
    }), r.reload);
  };
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  const rows = r.data ?? [];
  return (
    <>
      <h2>트랙별 정산 배치</h2>
      <p className="card warn">
        <b>트랙을 반드시 고르십시오.</b> 소개비와 제휴수수료는 성격이 달라 세금계산서도 따로 나갑니다.
        섞으면 소개비에서 공제한 것이 되어 <b>INV-9</b>가 깨집니다.
      </p>
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad">
        <div className="form-grid">
          <div><span className="dim" style={{ fontSize: 12.5 }}>트랙</span>
            <div className="ad-flt sm" role="radiogroup" aria-label="트랙" style={{ margin: '4px 0 0' }}>
              {Object.entries(TRACK).map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={track === k} className={track === k ? 'on' : ''} onClick={() => setTrack(k)}>{t}</button>
              ))}
            </div>
          </div>
          <label><span>시작일</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span>종료일</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="acts">
          <button className="btn-ok" disabled={a.busy === 'run'} onClick={run}>배치 실행</button>
          {onGo && <button className="btn-plain" onClick={() => onGo('payouts')}>확정 · 지급은 지급 탭에서</button>}
        </div>
      </div>

      <h3 className="sec">정산서 <em>{rows.length}</em></h3>
      {!r.data && <p className="muted">불러오는 중…</p>}
      {r.data && rows.length === 0 && <p className="muted">만든 정산서가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>파트너</th><th>트랙</th><th>기간</th><th>총액</th><th>실지급</th><th>계좌</th><th>상태</th></tr></thead>
          <tbody>
            {rows.slice(0, 100).map((s) => (
              <tr key={s.id}>
                <td>{s.companyName}</td><td>{TRACK[s.track] ?? s.track}</td>
                <td className="muted">{ymd(s.from)} ~ {ymd(s.to)}</td>
                <td className="num-cell">{n(s.gross)}원</td><td className="num-cell">{n(s.net)}원</td>
                <td>{s.accountReady ? <span className="st ok">인증</span> : <span className="st no">미등록</span>}</td>
                <td>{SST[s.state] ?? s.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card warn"><b>계좌가 인증되지 않으면 지급할 수 없습니다.</b> 돈을 보낼 곳이 없습니다.</p>
      <p className="card">
        <b>확정 없이 바로 지급할 수 없습니다.</b> 초안 → 확정 → 지급 순서이고, 지급한 것은 되돌릴 수 없습니다 —
        다음 회차에서 조정하십시오. 원천징수 3.3% 는 사업소득세입니다.
      </p>
    </>
  );
}
