import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymd } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { useHashSub } from '../../lib/hashSub';

interface Gwan {
  code: string; name: string; description: string | null;
  isActive: boolean; sortOrder: number;
  openedAt: string | null;
  publishedListings: number; categories: number; reviewPending: number;
}
interface Manage {
  code: string; name: string; isActive: boolean; isHub: boolean;
  sortOrder: number; categories: number; listings: number; isLanding: boolean;
  /** v10.36 — 신규 가입자 첫 화면(site.landing_new_member) */
  isNewMemberLanding?: boolean;
}
interface Scope { key: string; description: string | null; scope: string; affects: string }

type View = 'list' | 'new' | 'settings' | 'scope';

/**
 * SB-ADM-SIT-010 관 목록 · 현황
 * SB-ADM-GWN-010 관 관리 (순서 · 로그인 랜딩)
 * SB-ADM-SIT-020 새 관 만들기
 * SB-ADM-SIT-030 관 설정 (8개 탭)
 * SB-ADM-SIT-060 공유 경계 · 영향 범위
 *
 * 관 계층은 메인의 첫인상을 정합니다.
 * '소개하고 벌기'가 상위이고 나머지가 그 아래 품목별 갈래입니다.
 *
 * ── 역할 (서버 실측 2026-10-02) ─────────────────────────────────────
 * 순서 · 랜딩 · 관리 목록(`/admin/gwans/manage`)은 ADMIN 이 부를 수 있고,
 * 그 밖의 관 API(목록 · 상세 · 생성 · 설정 · 공유 경계)는 SUPER 만 됩니다.
 * 운영(ADMIN) 계정에게는 관리 목록만 보여 줍니다 — 나머지는 눌러도 403 입니다.
 *
 * 관 노출 전환(숨기기 · 노출하기)은 **메인 운영 › 관 노출**(SB-ADM-MAIN-020)
 * 한 곳에서만 합니다. 두 곳에 두면 어느 쪽에서 바꿨는지 추적이 갈립니다.
 */
export function Gwans({ onGo }: { onGo?: (tab: string) => void }) {
  const isSuper = tokenRoles().includes('SUPER');
  const [view, setView] = useHashSub<View>('list', ['list', 'new', 'settings', 'scope']);
  const [code, setCode] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [stab, setStab] = useState<STab>('basic');

  const tabs: SubTab<View>[] = [
    { key: 'list', label: '관 목록', screen: 'SB-ADM-SIT-010' },
    { key: 'new', label: '새 관 만들기', screen: 'SB-ADM-SIT-020', hidden: !isSuper },
    { key: 'settings', label: '관 설정', screen: 'SB-ADM-SIT-030', hidden: !isSuper },
    { key: 'scope', label: '공유 경계', screen: 'SB-ADM-SIT-060', hidden: !isSuper },
  ];
  const open = (c: string, t: STab = 'basic') => { setCode(c); setCreated(null); setStab(t); setView('settings'); };
  const onCreated = (c: string) => { setCode(c); setCreated(c); setView('settings'); };

  return (
    <section>
      <SubTabs tabs={tabs} value={view} onChange={setView} />
      {view === 'list' && <GwanList isSuper={isSuper} onOpen={open} onGo={onGo} onNew={() => setView('new')} />}
      {view === 'new' && isSuper && <GwanNew onCreated={onCreated} onCancel={() => setView('list')} />}
      {view === 'settings' && isSuper && <GwanSettings key={`${code}-${stab}`} code={code} created={created} initialTab={stab} onPick={(c) => { setCreated(null); setCode(c); }} onGo={onGo} />}
      {view === 'scope' && isSuper && <GwanScope />}
    </section>
  );
}

/* ── SB-ADM-SIT-010 · GWN-010 관 목록 ────────────────────────────── */
function GwanList({ isSuper, onOpen, onGo, onNew }: {
  isSuper: boolean; onOpen: (c: string, t?: STab) => void; onGo?: (t: string) => void; onNew: () => void;
}) {
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const [stats, setStats] = useState<Gwan[] | null>(null);
  const [order, setOrder] = useState<Record<string, string>>({});
  const [landing, setLanding] = useState<string>('');
  const [forNew, setForNew] = useState(false);
  const a = useAct();

  /* 현황(노출 등록 · 검수 대기)은 SUPER 만 부를 수 있습니다 */
  useEffect(() => {
    if (!isSuper) return;
    api<Gwan[]>('/admin/gwans').then(setStats).catch(() => setStats([]));
  }, [isSuper]);
  /* v10.36 — 「신규 가입자 첫 화면」을 켜면 그 설정의 지금 값을 보여 줍니다(전에는 늘 기존 회원 값만 보여 저장이 안 된 것처럼 보였습니다) */
  useEffect(() => {
    setLanding(manage.data?.find((g) => (forNew ? g.isNewMemberLanding : g.isLanding))?.code ?? '');
  }, [manage.data, forNew]);

  if (manage.error) return <ErrorView error={manage.error} onRetry={manage.reload} />;
  if (!manage.data) return <p className="muted">불러오는 중…</p>;

  const rows = [...manage.data].sort((x, y) => x.sortOrder - y.sortOrder);
  const byCode = new Map((stats ?? []).map((g) => [g.code, g]));
  const dirty = Object.keys(order).length > 0;

  function saveOrder() {
    const items = rows.map((g) => ({ code: g.code, sortOrder: Number(order[g.code] ?? g.sortOrder) }));
    if (items.some((i) => !Number.isInteger(i.sortOrder) || i.sortOrder < 0)) {
      a.setErr('순서는 0 이상의 정수로 적어 주십시오.'); return;
    }
    // 한 번에 전체를 보냅니다 — 하나씩 바꾸면 중간에 순서가 겹칩니다
    void a.run('order', () => api('/admin/gwans/order', { method: 'PATCH', body: JSON.stringify({ items }) }),
      () => { setOrder({}); manage.reload(); }, '순서를 저장했습니다. 메뉴와 목록 순서가 함께 바뀝니다.');
  }
  function saveLanding() {
    void a.run('landing', () => api('/admin/gwans/landing', {
      method: 'PATCH', body: JSON.stringify({ gwanCode: landing || null, forNewMember: forNew }),
    }), manage.reload, landing ? '로그인 후 랜딩을 바꿨습니다.' : '로그인 후 메인으로 보냅니다.');
  }

  /* v10.31 — 시안 ↑ ↓ 단추: 순서를 한 칸씩 옮겨 초안에 넣고, 「순서 저장」이 한 번에 보냅니다 */
  const ord = (g: Manage) => Number(order[g.code] ?? g.sortOrder);
  const sorted = [...rows].sort((x, y) => ord(x) - ord(y));
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= sorted.length) return;
    const nx = [...sorted]; const t = nx[i]!; nx[i] = nx[j]!; nx[j] = t;
    setOrder(Object.fromEntries(nx.map((g, k) => [g.code, String(k)])));
  };
  const sub = (c: string) => `${c.toLowerCase()}.sogaebank.com`;

  return (
    <>
      {isSuper && <div className="ad-dact" style={{ marginTop: 0 }}><button className="btn-ok" onClick={onNew}>새 관 만들기</button></div>}
      <Flash msg={a.msg} err={a.err} />

      <div className="ad-tw"><table className="tbl" data-gwan-list>
        <thead>
          <tr>
            <th>관</th><th>코드 · 서브도메인</th><th>상태</th><th>업종</th><th>등록 건수</th>
            {isSuper && <th>오픈일</th>}{isSuper && <th>검수 대기</th>}<th>랜딩</th><th>순서</th>{isSuper && <th />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((g, i) => {
            const st = byCode.get(g.code);
            return (
              <tr key={g.code}>
                <td><b>{g.name}</b>{g.isHub && <span className="ad-bg pp" style={{ marginLeft: 6 }}>상위</span>}</td>
                <td className="mono">{g.code}{!g.isHub && <> · {sub(g.code)}</>}</td>
                <td>{g.isActive
                  ? <span className="ad-bg ok">운영중</span>
                  : <span className="ad-bg wait">{g.categories === 0 ? '준비중' : '숨김'}</span>}</td>
                <td className="num-cell">{g.categories === 0 ? <b className="warn-text">0종</b> : `${g.categories}종`}</td>
                <td className="num-cell">{(st?.publishedListings ?? g.listings).toLocaleString('ko-KR')}</td>
                {isSuper && <td>{st?.openedAt ? new Date(st.openedAt).toLocaleDateString('ko-KR') : '—'}</td>}
                {isSuper && <td className="num-cell">{(st?.reviewPending ?? 0) > 0 ? <b className="warn-text">{st?.reviewPending}</b> : 0}</td>}
                <td>{g.isLanding || g.isNewMemberLanding
                  ? <>{g.isLanding && <b>랜딩</b>}{g.isLanding && g.isNewMemberLanding && ' · '}{g.isNewMemberLanding && <b>신규 가입자</b>}</>
                  : <span className="muted">—</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${g.name} 위로`}>↑</button>{' '}
                  <button className="btn-sm" disabled={i === sorted.length - 1} onClick={() => move(i, 1)} aria-label={`${g.name} 아래로`}>↓</button>{' '}
                  <input className="inp-sm" type="number" min={0} aria-label={`${g.name} 순서`} style={{ width: 56 }}
                         value={order[g.code] ?? String(g.sortOrder)}
                         onChange={(e) => setOrder((p) => ({ ...p, [g.code]: e.target.value }))} />
                </td>
                {isSuper && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-sm" onClick={() => onOpen(g.code)}>설정</button>
                    {!g.isActive && <> <button className="btn-sm" onClick={() => onOpen(g.code, 'open')} data-gwan-check={g.code}>오픈 점검</button></>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table></div>

      <div className="acts">
        <button className="btn-ok" disabled={!dirty || a.busy === 'order'} onClick={saveOrder}>순서 저장</button>
        {dirty && <button className="btn-plain" onClick={() => setOrder({})}>되돌리기</button>}
        {isSuper && onGo && (
          <button className="btn-plain" onClick={() => onGo('mainops/gwan')}>노출 전환 — 메인 운영 › 관 노출</button>
        )}
      </div>
      <p className="hint">순서는 <b>한 번에 전체를 보냅니다.</b> 하나씩 바꾸면 중간에 순서가 겹쳐 표시가 들쭉날쭉해집니다.</p>

      <h3 className="ad-s2">로그인 후 첫 화면</h3>
      <div className="card pad">
        <div className="form-grid">
          <label>
            <span>도착할 화면</span>
            <select value={landing} onChange={(e) => setLanding(e.target.value)} aria-label="로그인 후 랜딩">
              <option value="">통합 메인 (기본)</option>
              {rows.filter((g) => g.isActive && !g.isHub).map((g) => (
                <option key={g.code} value={g.code}>{g.name} 메인</option>
              ))}
            </select>
          </label>
          <label className="chk" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={forNew} onChange={(e) => setForNew(e.target.checked)} />
            <span>신규 가입자 첫 화면으로 지정 (끄면 기존 회원 로그인 후)</span>
          </label>
        </div>
        <div className="acts">
          <button className="btn-ok" disabled={a.busy === 'landing'} onClick={saveLanding}>저장</button>
        </div>
        <p className="hint">
          <b>중지된 관은 지정할 수 없습니다</b> — 로그인하자마자 &ldquo;중지 상태&rdquo; 화면을 보게 됩니다.
          신규 가입자 첫 화면은 <b>가입 완료 화면의 「시작하기」</b>가 그 관 메인으로 보냅니다(v10.37).
          그래서 목록에는 노출 중인 관만 나옵니다.
        </p>
      </div>

      <p className="card">
        <b>검수 대기가 쌓인 관을 숨기지 마십시오.</b> 숨겨도 검수 큐는 그대로 남는데,
        승인해도 이용자에게 보이지 않아 &ldquo;왜 안 올라오냐&rdquo;는 문의가 옵니다.
      </p>
      <p className="card">
        <b>승인된 업종이 없는 관은 열 수 없습니다.</b> 서버가 막습니다 — 열어도 빈 목록만
        보이고, 이용자는 서비스가 고장 난 것으로 봅니다.
      </p>
      <div className="ad-nt info">
        <b>관 URL은 관마다 서브도메인입니다 (C-10).</b> 루트 도메인은 어느 관에도 속하지 않는 통합 메인입니다. 로그인 세션은 상위 도메인 쿠키로 관을 넘나듭니다.
      </div>
      {/* v10.31 — 시안 아래 바로가기 4장 */}
      {onGo && (
        <div className="ad-mgrid" data-sit-links>
          {isSuper && <button className="ad-mcard" onClick={() => onGo('hub')}><b>통합 메인 관리</b><span>관으로 보내는 허브. 관이 늘면 카드가 자동으로 늘어납니다.</span></button>}
          {isSuper && <button className="ad-mcard" onClick={() => onGo('gwans/scope')}><b>관 공통 경계</b><span>관을 나눠도 나누지 않는 것들. 흔들리면 정산이 깨집니다.</span></button>}
          {isSuper && <button className="ad-mcard" onClick={() => onGo('siteinfo')}><b>사이트 기본 정보 · 법정 고지</b><span>푸터 고지의 원본. 비면 화면에 TBD 로 나갑니다.</span></button>}
          <button className="ad-mcard" onClick={() => onGo('gwan-ux')}><b>관 UI/UX 관리</b><span>관마다 다른 축과 UI 유형. 안심소개 3축 · 소개창업 4축을 켜고 끕니다.</span></button>
        </div>
      )}
    </>
  );
}

/* ── SB-ADM-SIT-020 새 관 만들기 ─────────────────────────────────── */
const TARGETS = [
  ['GOODS', '상품 · 서비스', '고정자산이 넘어가지 않습니다 — 소개장터 계열'],
  ['ASSET', '자산 · 매물', '고정자산이 넘어갑니다 — 안심소개 계열 (A-01)'],
  ['BIZ', '사업 기회', '가맹 · 출점 · 점포 양수도 — 소개창업 계열'],
] as const;
const STEPS = [
  ['무엇을 소개하는 관인가', '고정자산이 넘어가는가로 가릅니다 (A-01). 이것을 먼저 정하지 않으면 요율도 게이트도 정할 수 없습니다.'],
  ['관 이름 · 코드 · 서브도메인', '코드와 소개 대상은 생성 후 바꿀 수 없습니다.'],
  ['업종 · 등급', '카테고리가 등급을 결정합니다 (A-11). 업종 승인 화면에서 붙입니다.'],
  ['소개비 부담 주체', '업종마다 정합니다 — 업종 관리에서 붙인 업종에 부담 주체(판매자 · 구매자)를 정합니다.'],
  ['오픈 체크리스트', '전부 통과해야 준비중 → 운영중으로 넘어갑니다.'],
];

function GwanNew({ onCreated, onCancel }: { onCreated: (code: string) => void; onCancel: () => void }) {
  const [target, setTarget] = useState<string>('GOODS');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [step, setStep] = useState<0 | 1>(0);   // v10.32 — 시안 위자드: 1단계(소개 대상) → 다음 → 2단계(이름 · 코드)
  const a = useAct();

  const codeOk = /^[A-Z]{3}$/.test(code);
  const nameOk = name.trim().length >= 2 && name.trim().length <= 20;

  async function create() {
    const t = TARGETS.find((x) => x[0] === target)?.[1];
    const r = await a.run('new', () => api<{ code?: string }>('/admin/gwans', {
      method: 'POST',
      body: JSON.stringify({
        code, name: name.trim(),
        // 소개 대상은 아직 서버 필드가 없어 설명 앞에 적어 둡니다(보고서 참조)
        description: [t ? `[${t}]` : '', desc.trim()].filter(Boolean).join(' ') || undefined,
      }),
    }), undefined, '관을 만들었습니다. 비활성(준비중)으로 만들어집니다 — 업종을 붙인 뒤 여십시오.');
    if (r) onCreated(code);
  }

  /* v10.32 — 시안(scAdmSitNew) 배치: 세로 5단계(지금 단계 강조) → 지금 단계 카드 하나 → 노란 띠 → 다음 · 취소.
   * 전에는 5단계를 가로 5칸으로 두고 1 · 2단계 입력을 한 카드에 함께 보였습니다. 입력 · 서버 호출(POST /admin/gwans)은 그대로입니다. */
  return (
    <>
      {/* 제목 · 설명은 위 제목 줄(SUB_PAGE 'gwans/new') */}
      <ol className="ad-nsteps" data-gwan-steps>
        {STEPS.map(([t, d], i) => (
          <li key={t} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="n">{i + 1}</span><div><b>{t}</b><p>{d}</p></div>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="ad-fset" data-gwan-step="1">
          <h3>1. 무엇을 소개하는 관인가</h3>
          {TARGETS.map(([k, t, d]) => (
            <label key={k} className={`ad-rz${target === k ? ' on' : ''}`}>
              <input type="radio" name="gwan-target" checked={target === k} onChange={() => setTarget(k)} aria-label={t} />
              <b>{t}</b><span>{d}</span>
            </label>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="ad-fset" data-gwan-step="2">
          <h3>2. 관 이름 · 코드 <span className="dim" style={{ fontWeight: 500 }}>· 소개 대상 {TARGETS.find((x) => x[0] === target)?.[1]}</span></h3>
          <div className="form-grid">
            <label>
              <span>코드 (영문 대문자 3자 · 생성 후 변경 불가)</span>
              <input value={code} maxLength={3} placeholder="예) EDU"
                     onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            </label>
            <label>
              <span>관 이름 (2~20자)</span>
              <input value={name} maxLength={20} placeholder="예) 소개배움" onChange={(e) => setName(e.target.value)} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>설명 (메인 카드에 나갑니다)</span>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
          </div>
          {code && !codeOk && <p className="warn-text">코드는 영문 대문자 3자입니다.</p>}
          <Flash msg={a.msg} err={a.err} />
        </div>
      )}

      <div className="ad-nt warn">
        <b>새 관은 준비중(비활성) 상태로만 생성됩니다.</b> 업종 · 검수 인력 · 정산 흐름이 준비되기 전에
        열면 등록만 쌓이고 노출이 안 됩니다. 여는 것은 관 설정의 &lsquo;공개 상태&rsquo;에서 합니다 — 3~5단계(업종 · 부담 주체 · 오픈 체크리스트)는 만든 뒤 관 설정에서 합니다.
      </div>

      <div className="ad-dact">
        {step === 0 ? (
          <button className="btn-ok" onClick={() => setStep(1)} data-gwan-next>다음</button>
        ) : (
          <>
            <button className="btn-ok" disabled={!codeOk || !nameOk || a.busy === 'new'} onClick={() => void create()}>
              만들기
            </button>
            <button className="btn-plain" onClick={() => setStep(0)}>← 이전</button>
          </>
        )}
        <button className="btn-plain" onClick={onCancel}>취소</button>
      </div>
    </>
  );
}

/* ── SB-ADM-SIT-030 관 설정 (8개 탭) ─────────────────────────────── */
type STab = 'basic' | 'status' | 'order' | 'landing' | 'stats' | 'fixed' | 'category' | 'open';
const STABS: SubTab<STab>[] = [
  { key: 'basic', label: '기본 정보', screen: 'SB-ADM-SIT-030' },
  { key: 'status', label: '공개 상태', screen: 'SB-ADM-SIT-030' },
  { key: 'order', label: '노출 순서', screen: 'SB-ADM-SIT-030' },
  { key: 'landing', label: '로그인 랜딩', screen: 'SB-ADM-SIT-030' },
  { key: 'stats', label: '현황', screen: 'SB-ADM-SIT-030' },
  { key: 'fixed', label: '고정 항목', screen: 'SB-ADM-SIT-030' },
  { key: 'category', label: '업종', screen: 'SB-ADM-SIT-030' },
  { key: 'open', label: '오픈 점검', screen: 'SB-ADM-SIT-030' },
];

function GwanSettings({ code, created, onPick, onGo, initialTab }: {
  code: string | null; created: string | null; onPick: (c: string) => void; onGo?: (t: string) => void; initialTab?: STab }) {
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const [g, setG] = useState<Gwan | null>(null);
  const [gErr, setGErr] = useState<unknown>(null);
  const [tab, setTab] = useState<STab>(initialTab ?? 'basic');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [sort, setSort] = useState('');
  const [forNew, setForNew] = useState(false);
  const a = useAct();

  const cur = code ?? manage.data?.[0]?.code ?? null;
  const load = () => {
    if (!cur) return;
    setGErr(null);
    api<Gwan>(`/admin/gwans/${cur}`).then((d) => {
      setG(d); setName(d.name); setDesc(d.description ?? ''); setSort(String(d.sortOrder));
    }).catch(setGErr);
  };
  useEffect(load, [cur]);

  if (manage.error) return <ErrorView error={manage.error} onRetry={manage.reload} />;
  if (gErr) return <ErrorView error={gErr} onRetry={load} />;
  if (!manage.data || !g) return <p className="muted">불러오는 중…</p>;

  const m = manage.data.find((x) => x.code === g.code);
  const after = () => { load(); manage.reload(); };
  const patch = (body: Record<string, unknown>, ok: string) =>
    a.run('patch', () => api(`/admin/gwans/${g.code}`, { method: 'PATCH', body: JSON.stringify(body) }), after, ok);

  function saveOrder() {
    const v = Number(sort);
    if (!Number.isInteger(v) || v < 0) { a.setErr('순서는 0 이상의 정수입니다.'); return; }
    const items = manage.data!.map((x) => ({ code: x.code, sortOrder: x.code === g!.code ? v : x.sortOrder }));
    void a.run('order', () => api('/admin/gwans/order', { method: 'PATCH', body: JSON.stringify({ items }) }),
      after, '순서를 저장했습니다.');
  }
  function setLanding(on: boolean) {
    void a.run('landing', () => api('/admin/gwans/landing', {
      method: 'PATCH', body: JSON.stringify({ gwanCode: on ? g!.code : null, forNewMember: forNew }),
    }), after, on ? `${g!.name}을(를) 로그인 후 랜딩으로 지정했습니다.` : '랜딩을 메인으로 돌렸습니다.');
  }

  const checks: Array<[string, boolean, string]> = [
    ['업종 1종 이상 승인', g.categories > 0, `${g.categories}종 승인됨`],
    ['설명 입력', !!g.description, g.description ? '입력됨' : '비어 있음 — 메인 카드가 빕니다'],
    ['검수 대기 없음', g.reviewPending === 0, `대기 ${g.reviewPending}건`],
    ['공개 상태', g.isActive, g.isActive ? '운영중' : '준비중'],
  ];

  return (
    <>
      <div className="search-row" style={{ alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{g.name} <span className="muted">{g.code}</span> · 관 설정</h2>
        <select className="sel" style={{ marginBottom: 0, marginLeft: 'auto' }} value={g.code}
                aria-label="관 선택" onChange={(e) => { a.clear(); onPick(e.target.value); }}>
          {manage.data.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
        </select>
      </div>
      <p className="lead">코드와 소개 대상은 생성 후 바꿀 수 없습니다. 나머지는 배포 없이 즉시 반영됩니다.</p>
      <SubTabs tabs={STABS} value={tab} onChange={(t) => { a.clear(); setTab(t); }} />
      {created === g.code && !a.msg && !a.err && (
        <p className="form-ok">새 관 {g.name}({g.code})을(를) 만들었습니다. 준비중(비활성)입니다 — 업종을 붙인 뒤 &lsquo;공개 상태&rsquo;에서 여십시오.</p>
      )}
      <Flash msg={a.msg} err={a.err} />

      {tab === 'basic' && (
        <>
        {/* v10.31 — 시안 「항목 · 값 · 변경」 표 + 「저장 · 관 중지」 */}
        <div className="ad-tw"><table className="tbl" data-gwan-props>
          <thead><tr><th>항목</th><th>값</th><th>변경</th></tr></thead>
          <tbody>
            <tr><td><b>코드</b></td><td className="mono">{g.code}</td><td className="dim">생성 후 변경 불가</td></tr>
            <tr><td><b>서브도메인</b></td><td className="mono">{g.code.toLowerCase()}.sogaebank.com</td><td className="dim">변경 시 리다이렉트 필요</td></tr>
            <tr><td><b>인증 게이트</b></td><td>등록 · 1:1 문의 시작 시 (서버 게이트)</td><td className="dim">즉시 반영</td></tr>
            <tr><td><b>공개 상태</b></td><td>{g.isActive ? '운영중' : '준비중'}</td><td className="dim">즉시 반영 — 「공개 상태」 탭</td></tr>
          </tbody>
        </table></div>
        <div className="ad-nt info"><b>서브도메인을 바꾸면 기존 주소에서 리다이렉트를 걸어야 합니다.</b> 검색엔진에 색인된 주소가 끊깁니다.</div>
        <div className="card pad">
          <div className="form-grid">
            <label><span>관 이름</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>설명</span><input value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === 'patch' || name.trim().length < 2}
                    onClick={() => void patch({ name: name.trim(), description: desc.trim() }, '저장했습니다. 바로 반영됩니다.')}>
              저장
            </button>
            {g.isActive && <button className="btn-no" disabled={a.busy === 'patch'} onClick={() => {
              if (!confirm(`${g.name}을(를) 중지합니다.\n신규만 막히고 진행 중 거래는 끝까지 갑니다.`)) return;
              void patch({ isActive: false }, '관을 중지했습니다.');
            }}>관 중지</button>}
          </div>
        </div>
        </>
      )}

      {tab === 'status' && (
        <div className="card pad">
          <p>지금 <b>{g.isActive ? '운영중(노출)' : '준비중(숨김)'}</b> · 승인 업종 {g.categories}종</p>
          <div className="acts">
            <button className={g.isActive ? 'btn-no' : 'btn-ok'} disabled={a.busy === 'patch'}
                    onClick={() => {
                      if (g.isActive && !confirm(`${g.name}을(를) 중지합니다.\n신규만 막히고 진행 중 거래는 끝까지 갑니다.`)) return;
                      void patch({ isActive: !g.isActive }, g.isActive ? '관을 중지했습니다.' : '관을 열었습니다.');
                    }}>
              {g.isActive ? '관 중지' : '관 열기'}
            </button>
          </div>
          <p className="hint">
            <b>승인된 업종이 없으면 열 수 없습니다</b> — 등록 폼의 선택지가 비어 사용자가 막힙니다(서버가 422 로 거절).
            중지하면 등록 · 노출이 즉시 멈추지만 매물은 지우지 않습니다.
          </p>
        </div>
      )}

      {tab === 'order' && (
        <div className="card pad">
          <div className="form-grid">
            <label><span>노출 순서 (작을수록 앞)</span>
              <input type="number" min={0} value={sort} onChange={(e) => setSort(e.target.value)} />
            </label>
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === 'order'} onClick={saveOrder}>순서 저장</button>
          </div>
          <p className="hint">다른 관의 순서는 그대로 두고 함께 보냅니다 — 서버는 한 번에 전체를 받습니다.</p>
        </div>
      )}

      {tab === 'landing' && (
        <div className="card pad">
          <p>{m?.isLanding ? <b>이 관이 로그인 후 랜딩입니다.</b> : '이 관은 랜딩이 아닙니다.'}
            {m?.isNewMemberLanding && <> <b>신규 가입자 첫 화면으로도 지정돼 있습니다.</b></>}</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={forNew} onChange={(e) => setForNew(e.target.checked)} /> 신규 가입자 첫 화면으로 지정 (끄면 기존 회원 로그인 후)
          </label>
          <div className="acts">
            <button className="btn-ok" disabled={!g.isActive || a.busy === 'landing'} onClick={() => setLanding(true)}>
              이 관을 랜딩으로
            </button>
            {(forNew ? m?.isNewMemberLanding : m?.isLanding) && (
              <button className="btn-plain" disabled={a.busy === 'landing'} onClick={() => setLanding(false)}>
                메인으로 되돌리기
              </button>
            )}
          </div>
          {!g.isActive && <p className="hint"><b>중지된 관은 랜딩으로 지정할 수 없습니다.</b></p>}
        </div>
      )}

      {tab === 'stats' && (
        <table className="tbl">
          <tbody>
            <tr><th>노출 중인 등록</th><td className="num-cell">{n(g.publishedListings)}</td></tr>
            <tr><th>승인 업종</th><td className="num-cell">{n(g.categories)}</td></tr>
            <tr><th>검수 대기</th><td className="num-cell">{g.reviewPending > 0 ? <b className="warn-text">{n(g.reviewPending)}</b> : 0}</td></tr>
            <tr><th>연 날</th><td>{ymd(g.openedAt)}</td></tr>
            <tr><th>순서</th><td className="num-cell">{g.sortOrder}</td></tr>
          </tbody>
        </table>
      )}

      {tab === 'fixed' && (
        <>
          <table className="tbl">
            <thead><tr><th>항목</th><th>값</th><th>변경</th></tr></thead>
            <tbody>
              <tr><td><b>코드</b></td><td className="mono">{g.code}</td><td><span className="badge badge-urgent">생성 후 변경 불가</span></td></tr>
              <tr><td><b>소개 대상</b></td><td>{/^\[(.+?)\]/.exec(g.description ?? '')?.[1] ?? '설명 참조'}</td><td><span className="badge badge-urgent">생성 후 변경 불가</span></td></tr>
              <tr><td><b>상위 관</b></td><td>{m?.isHub ? '예' : '아니오'}</td><td><span className="badge badge-urgent">DB 고정 — 상위는 하나</span></td></tr>
            </tbody>
          </table>
          <p className="hint">
            코드가 바뀌면 소개코드 · 정산 기록이 가리키는 곳이 사라집니다. 소개 대상이 바뀌면 요율과 게이트가 달라집니다.
          </p>
        </>
      )}

      {tab === 'category' && (
        <div className="card pad">
          <p>승인된 업종 <b>{g.categories}</b>종 {g.categories === 0 && <b className="warn-text">— 이 상태로는 열 수 없습니다</b>}</p>
          {onGo && <button className="btn-plain" onClick={() => onGo('category')}>업종 승인 화면으로</button>}
          <p className="hint">카테고리가 등급을 결정합니다 (A-11). 업종은 관에 종속되고 관마다 다릅니다.</p>
        </div>
      )}

      {tab === 'open' && (
        <>
          <table className="tbl">
            <thead><tr><th>점검</th><th>결과</th><th>내용</th></tr></thead>
            <tbody>
              {checks.map(([t, ok, d]) => (
                <tr key={t}>
                  <td><b>{t}</b></td>
                  <td>{ok ? <span className="st ok">통과</span> : <span className="st no">미통과</span>}</td>
                  <td className="muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {onGo && <div className="acts"><button className="btn-plain" onClick={() => onGo('checklist')}>전체 오픈 체크리스트</button></div>}
        </>
      )}

      <p className="card warn">
        <b>관을 중지해도 등록은 지워지지 않습니다.</b> 목록에서만 빠지며 다시 열면 그대로 돌아옵니다.
      </p>
    </>
  );
}

/* ── SB-ADM-SIT-060 공유 경계 · 영향 범위 ────────────────────────── */
const COMMON: Array<[string, boolean, string]> = [
  ['회원 · 사업자 인증', true, '가입은 한 번, 전 관 공통'],
  ['소개코드 · 귀속', true, '코드 체계가 갈리면 정산이 깨집니다'],
  ['정산 · 지급', true, '계좌와 세금계산서는 회원 단위'],
  ['구독', true, '요금제는 계정 단위 (B-13R)'],
  ['업종 · 등급', false, '관에 종속됩니다'],
  ['소개비 부담 주체', false, '관마다 하나로 고정'],
];

function GwanScope() {
  const gwans = useApi<Gwan[]>('/admin/gwans');
  const scope = useApi<Scope[]>('/admin/scope');

  if (scope.error) return <ErrorView error={scope.error} onRetry={scope.reload} />;
  if (!scope.data || !gwans.data) return <p className="muted">불러오는 중…</p>;

  const rows = scope.data;
  const global = rows.filter((r) => r.scope === 'GLOBAL');
  const perGwan = rows.filter((r) => r.scope !== 'GLOBAL');

  return (
    <>
      <h2>공유 경계 · 영향 범위</h2>
      <p className="lead">관을 나눠도 나누지 않는 것들입니다. 이 경계가 흔들리면 정산이 깨집니다.</p>

      <table className="tbl">
        <thead><tr><th>항목</th><th>경계</th><th>이유</th></tr></thead>
        <tbody>
          {COMMON.map(([t, one, why]) => (
            <tr key={t}>
              <td><b>{t}</b></td>
              <td>{one ? <span className="badge badge-verified">관을 나눠도 하나</span>
                       : <span className="badge badge-urgent">관마다 다름</span>}</td>
              <td className="muted">{why}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="card warn">
        <b>전 관 공통 설정을 바꾸면 모든 관({gwans.data.length}개)이 함께 바뀝니다.</b> 한 관만 바꾸려던 것이
        전체에 퍼지는 일이 여기서 생깁니다.
      </p>

      <h3 className="sec">모든 관에 적용 <em>{global.length}</em></h3>
      <table className="tbl">
        <thead><tr><th>설정</th><th>설명</th><th>영향</th></tr></thead>
        <tbody>
          {global.map((r) => (
            <tr key={r.key}>
              <td><span className="mono">{r.key}</span></td>
              <td className="muted">{r.description}</td>
              <td><b className="warn-text">{r.affects}</b></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="sec">관별 적용 <em>{perGwan.length}</em></h3>
      {perGwan.length === 0
        ? <p className="muted">관별로만 적용되는 설정이 없습니다.</p>
        : (
          <table className="tbl">
            <thead><tr><th>설정</th><th>설명</th><th>범위</th></tr></thead>
            <tbody>
              {perGwan.map((r) => (
                <tr key={r.key}>
                  <td><span className="mono">{r.key}</span></td>
                  <td className="muted">{r.description}</td>
                  <td>{r.affects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <p className="card">
        <b>금칙어는 같은 표인데 행마다 범위가 다릅니다.</b> 관 코드가 비어 있으면 전 관 공통이고,
        값이 있으면 그 관에만 적용됩니다. 정책 화면에서 관 열을 확인하십시오.
      </p>
    </>
  );
}
