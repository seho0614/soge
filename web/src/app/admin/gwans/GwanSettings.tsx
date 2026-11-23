import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { SubTabs, type SubTab } from '../../../components/SubTabs';
import { categoryCheck, type Gwan, type Manage, type STab } from './shared';

/* v10.646 (D309 · docs/791) 등록 폼 문구 — 소개합니다(OFFER) · 찾습니다(REQUEST). 하나도 없으면 관을 열 수 없음(NO_FORM_COPY) */
interface FormCopy { role: string; subject: string; titleHint: string; bodyHint: string; notice: string | null }
const ROLES = [['OFFER', '소개합니다(파는 쪽 · 매물 등록)'], ['REQUEST', '찾습니다(구하는 쪽 · 소개받기 요청)']] as const;
function FormCopyTab({ code }: { code: string }) {
  const fc = useApi<FormCopy[]>(`/admin/gwans/${code}/form-copy`);
  const [ed, setEd] = useState<Record<string, FormCopy>>({});
  const a = useAct();
  useEffect(() => {
    const m: Record<string, FormCopy> = {};
    for (const [r] of ROLES) m[r] = fc.data?.find((x) => x.role === r) ?? { role: r, subject: '', titleHint: '', bodyHint: '', notice: '' };
    setEd(m);
  }, [fc.data]);
  if (fc.error) return <ErrorView error={fc.error} onRetry={fc.reload} />;
  if (!fc.data) return <p className="muted">불러오는 중…</p>;
  const set = (r: string, k: keyof FormCopy, v: string) => setEd({ ...ed, [r]: { ...ed[r]!, [k]: v } });
  return (
    <>
      <p className="lead">사용자 웹 등록 폼의 머리 · 칸 안내입니다. <b>둘 중 하나 이상 있어야 관을 열 수 있습니다.</b> 영어 등 번역은 관 관리 › 번역 검수에서 합니다.</p>
      <Flash msg={a.msg} err={a.err} />
      {ROLES.map(([r, label]) => {
        const v = ed[r]; if (!v) return null;
        const saved = fc.data!.some((x) => x.role === r);
        const ok = v.subject.trim() && v.titleHint.trim() && v.bodyHint.trim();
        return (
          <div key={r} className="card pad" data-gwan-form={r}>
            <h3 style={{ marginTop: 0 }}>{label} <span className="dim">{saved ? '· 저장됨' : '· 아직 없음'}</span></h3>
            <div className="form-grid">
              <label><span>무엇을 등록하나(폼 머리 · 40자)</span><input value={v.subject} maxLength={40} placeholder="예) 배움 · 강의" onChange={(e) => set(r, 'subject', e.target.value)} /></label>
              <label><span>제목 칸 안내(200자)</span><input value={v.titleHint} maxLength={200} placeholder="예) 무엇을 가르치는지 한 줄로" onChange={(e) => set(r, 'titleHint', e.target.value)} /></label>
              <label style={{ gridColumn: '1 / -1' }}><span>본문 칸 안내(1,000자)</span><textarea rows={3} value={v.bodyHint} maxLength={1000} placeholder="예) 대상 · 기간 · 장소 · 비용을 적어 주세요" onChange={(e) => set(r, 'bodyHint', e.target.value)} /></label>
              <label style={{ gridColumn: '1 / -1' }}><span>주의 한 줄(선택 · 500자)</span><input value={v.notice ?? ''} maxLength={500} onChange={(e) => set(r, 'notice', e.target.value)} /></label>
            </div>
            <div className="acts">
              <button className="btn-ok" disabled={!ok || a.busy === `fc${r}`} data-gwan-form-save={r}
                      onClick={() => void a.run(`fc${r}`, () => api(`/admin/gwans/${code}/form-copy/${r}`, { method: 'PUT',
                        body: JSON.stringify({ subject: v.subject.trim(), titleHint: v.titleHint.trim(), bodyHint: v.bodyHint.trim(), notice: (v.notice ?? '').trim() || undefined }) }),
                        fc.reload, '저장했습니다. 사용자 웹 등록 폼에 바로 반영됩니다.')}>저장</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

/* v10.647 (docs/792) 처음 관의 사용자 웹 주소(site/src/lib/format.ts FIXED_GWAN_PATH 와 같게) — 나머지 관은 g/<코드 소문자> */
const GWAN_WEB_PATH: Record<string, string> = { MNY: 'money', MAL: 'mall', BIZ: 'biz', HLT: 'health', LED: 'lead' };

const STABS: SubTab<STab>[] = [
  { key: 'basic', label: '기본 정보', screen: 'SB-ADM-SIT-030' },
  { key: 'form', label: '등록 폼 문구', screen: 'SB-ADM-SIT-030' },   // v10.646 (D309 · docs/791)
  { key: 'status', label: '공개 상태', screen: 'SB-ADM-SIT-030' },
  { key: 'order', label: '노출 순서', screen: 'SB-ADM-SIT-030' },
  { key: 'landing', label: '로그인 랜딩', screen: 'SB-ADM-SIT-030' },
  { key: 'stats', label: '현황', screen: 'SB-ADM-SIT-030' },
  { key: 'fixed', label: '고정 항목', screen: 'SB-ADM-SIT-030' },
  { key: 'category', label: '업종', screen: 'SB-ADM-SIT-030' },
  { key: 'open', label: '오픈 점검', screen: 'SB-ADM-SIT-030' },
];

export function GwanSettings({ code, created, onPick, onGo, initialTab }: {
  code: string | null; created: string | null; onPick: (c: string) => void; onGo?: (t: string) => void; initialTab?: STab }) {
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const [g, setG] = useState<Gwan | null>(null);
  const [gErr, setGErr] = useState<unknown>(null);
  const [tab, setTab] = useState<STab>(initialTab ?? 'basic');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [sort, setSort] = useState('');
  const [forNew, setForNew] = useState(false);
  const [parent, setParent] = useState('');   // v10.646 (D309) 상위 관(허브)
  const a = useAct();

  const cur = code ?? manage.data?.[0]?.code ?? null;
  const load = () => {
    if (!cur) return;
    setGErr(null);
    api<Gwan>(`/admin/gwans/${cur}`).then((d) => {
      setG(d); setName(d.name); setDesc(d.description ?? ''); setSort(String(d.sortOrder)); setParent(d.parentCode ?? '');
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
    ['업종 1종 이상 승인', ...categoryCheck(g)],   // v10.642 (docs/786) 허브 · 리드관
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
            <tr><td><b>소개 대상</b></td><td>{g.introTarget === 'GOODS' ? '상품 · 서비스' : g.introTarget === 'ASSET' ? '자산 · 매물' : g.introTarget === 'BIZ' ? '사업 기회' : '정하지 않음(처음 관)'}</td><td className="dim">생성 후 변경 불가</td></tr>
            <tr><td><b>상위 관(허브)</b></td><td>{g.isHub ? '허브 관 자신' : g.parentName ? `${g.parentName} (${g.parentCode})` : '없음'}</td><td className="dim">아래에서 바꿈 · 허브 관만 고를 수 있음</td></tr>
            {/* v10.647 (docs/792) 실제 사용자 웹 주소 — 처음 관은 고정 주소(/money 등) · 새 관은 /g/<코드 소문자> · 허브는 주소 없음(전: 「서브도메인 edu.sogaebank.com」 — 쓰지 않는 주소) */}
            <tr><td><b>사용자 웹 주소</b></td><td className="mono">{g.isHub ? '없음(허브 관 — 하위 관 묶음)' : `sogaebank.com/${GWAN_WEB_PATH[g.code] ?? `g/${g.code.toLowerCase()}`}`}</td><td className="dim">코드로 정해짐 · 바꿀 수 없음</td></tr>
            <tr><td><b>인증 게이트</b></td><td>등록 · 1:1 문의 시작 시 (서버 게이트)</td><td className="dim">즉시 반영</td></tr>
            <tr><td><b>공개 상태</b></td><td>{g.isActive ? '운영중' : '준비중'}</td><td className="dim">즉시 반영 — 「공개 상태」 탭</td></tr>
          </tbody>
        </table></div>
        <div className="card pad">
          <div className="form-grid">
            <label><span>관 이름</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            {!g.isHub && (
              <label><span>상위 관(허브)</span>
                <select value={parent} onChange={(e) => setParent(e.target.value)} data-gwan-parent>
                  <option value="">없음</option>
                  {manage.data.filter((x) => x.isHub && x.code !== g.code).map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                </select>
              </label>
            )}
            <label style={{ gridColumn: '1 / -1' }}>
              <span>설명</span><input value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === 'patch' || name.trim().length < 2}
                    onClick={() => void patch({ name: name.trim(), description: desc.trim(), ...(g.isHub ? {} : { parentCode: parent }) }, '저장했습니다. 바로 반영됩니다.')}>
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

      {tab === 'form' && <FormCopyTab code={g.code} />}

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
          {g.isHub || g.consultCategories != null
            ? <p data-cat-basis={g.isHub ? 'hub' : 'consult'}>{categoryCheck(g)[1]}</p>   /* v10.642 (docs/786) */
            : <p>승인된 업종 <b>{g.categories}</b>종 {g.categories === 0 && <b className="warn-text">— 이 상태로는 열 수 없습니다</b>}</p>}
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
