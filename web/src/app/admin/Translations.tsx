import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';

/* ════════════════════════════════════════════════════════════════════
 * SB-ADM-TRN-010 번역 — v10.93 다국어 1단계 기반 (D115 · docs/148 · docs/150)
 *   번역 목록 · 승인 / 번역 넣기(MANUAL) / 언어 켜고 끄기
 *   다국어(i18n.enabled)가 꺼져 있는 동안 손님 화면은 바뀌지 않습니다 — 미리 넣고 승인해 둡니다.
 *   v10.103 다국어 3-1 — 「원문 목록」: 운영 글(공지 · 자주 묻는 질문 · 약관 · 분류 이름 · 소개몰 상품)을 골라
 *     칸마다 번역 상태를 보고, 그 자리에서 원문을 보며 번역을 넣고 승인 · 반려 (GET admin/i18n/catalog)
 *   v10.104 다국어 3-2 — 「자동 번역」: 등록 글(매물 · 요청) 자동 번역 작업 줄 · 다시 시도 · 노출 중인 글 한꺼번에 넣기 (GET admin/i18n/jobs)
 * ════════════════════════════════════════════════════════════════════ */

type View = 'list' | 'catalog' | 'jobs' | 'new' | 'langs';
const TABS: SubTab<View>[] = [
  { key: 'list', label: '번역 목록 · 승인', screen: 'SB-ADM-TRN-010' },
  { key: 'catalog', label: '원문 목록', screen: 'SB-ADM-TRN-010' },
  { key: 'jobs', label: '자동 번역', screen: 'SB-ADM-TRN-010' },
  { key: 'new', label: '번역 넣기', screen: 'SB-ADM-TRN-010' },
  { key: 'langs', label: '언어', screen: 'SB-ADM-TRN-010' },
];
const TYPE_KO: Record<string, string> = {
  NOTICE: '공지', FAQ: '자주 묻는 질문', TERM: '약관', LISTING: '매물', REQUEST: '요청', POST: '소개광장 글', COMMENT: '댓글',
  CATEGORY: '분류 이름', HLT_PRODUCT: '소개몰 상품',
  PROFILE_Q: '관심 성향 문항', PROFILE_OPT: '관심 성향 보기', AD_SEGMENT: '관심 성향 세그먼트',   // v10.118
  FOOTER_LINK: '바닥줄 링크', SETTING: '법정 고지', POLL: '투표', POLL_OPT: '투표 보기', INGREDIENT: '소개몰 성분', HLT_CONCERN: '소개몰 고민',   // v10.119
  NOTIFY_EVENT: '알림 종류', REPORT_REASON: '신고 사유', PLAN: '요금제', INTRO_GRADE: '소개자 등급', GWAN_FORM: '업무 등록 안내', UI_MESSAGE: '화면 고정 문구', AD_PLACEMENT: '광고 자리 소재',   // v10.123
};
/** 원문 목록(3-1)에서 고를 수 있는 대상 — 서버 CATALOG_TYPES 와 같음 */
const CATALOG_TYPES = ['NOTICE', 'FAQ', 'TERM', 'CATEGORY', 'HLT_PRODUCT', 'PROFILE_Q', 'PROFILE_OPT', 'AD_SEGMENT',
  'FOOTER_LINK', 'SETTING', 'POLL', 'POLL_OPT', 'INGREDIENT', 'HLT_CONCERN',
  'NOTIFY_EVENT', 'REPORT_REASON', 'PLAN', 'INTRO_GRADE', 'GWAN_FORM', 'UI_MESSAGE', 'AD_PLACEMENT'] as const;
const FIELDS: Record<string, string[]> = {
  NOTICE: ['title', 'body'], FAQ: ['question', 'answer'], TERM: ['title', 'body'],
  LISTING: ['title', 'body'], REQUEST: ['title', 'body'], POST: ['title', 'body'], COMMENT: ['body'],
  CATEGORY: ['name'], HLT_PRODUCT: ['name', 'summary'],
  PROFILE_Q: ['question'], PROFILE_OPT: ['label'], AD_SEGMENT: ['name', 'description'],
  FOOTER_LINK: ['label'], SETTING: ['value'], POLL: ['title', 'description'], POLL_OPT: ['label', 'sub'],
  INGREDIENT: ['name'], HLT_CONCERN: ['name'],
  NOTIFY_EVENT: ['name', 'legal_basis'], REPORT_REASON: ['label'], PLAN: ['name', 'features'],
  INTRO_GRADE: ['name', 'criteria', 'benefit', 'next_hint'], GWAN_FORM: ['subject', 'title_hint', 'body_hint', 'notice'],
  UI_MESSAGE: ['message'], AD_PLACEMENT: ['title', 'body', 'cta'],
};
const FIELD_KO: Record<string, string> = { title: '제목', body: '본문', question: '질문', answer: '답', name: '이름', summary: '요약', label: '보기', description: '설명', value: '문장', sub: '보조 글',
  legal_basis: '근거', features: '혜택(줄마다)', criteria: '조건', benefit: '혜택', next_hint: '다음 등급 안내', subject: '대상', title_hint: '제목 힌트',
  body_hint: '본문 힌트', notice: '안내', message: '문구', cta: '단추' };   // v10.123
const ST_KO: Record<string, string> = {
  DRAFT: '승인 대기', APPROVED: '승인', AUTO_APPROVED: '자동 승인', MACHINE: '기계 번역', REJECTED: '반려',
};
/** 자동 번역 작업 줄 상태 · 결과(v10.104) */
const JOB_KO: Record<string, string> = { QUEUED: '대기', RUNNING: '처리 중', DONE: '끝', HELD: '보류', FAILED: '실패' };
const RESULT_KO: Record<string, string> = {
  AUTO_APPROVED: '자동 승인', DRAFT: '금칙어 — 승인 대기', SKIPPED: '사람이 승인한 번역 있음', SOURCE_MISSING: '원문 없음', REFUSAL: '엔진 거절', TOO_LONG: '글이 김',
};

interface Row {
  id: string; targetType: string; targetId: string; field: string; lang: string; text: string; status: string; engine: string;
  sourceText: string | null; sourceMissing: boolean; isStale: boolean; translatedAt: string; approvedAt: string | null; rejectReason: string | null;
}
interface Page { items: Row[]; total: number; page: number; size: number; pages: number }
interface Lang { code: string; name: string; native: string; rtl: boolean; isActive: boolean; sortOrder: number; translations: number }
interface Langs { enabled: boolean; engine: string | null; items: Lang[] }

export function Translations() {
  const [view, setView] = useState<View>('list');
  const [prefill, setPrefill] = useState<Partial<Row> | null>(null);
  return (
    <>
      <SubTabs tabs={TABS} value={view} onChange={setView} />
      {view === 'list' && <List onEdit={(r) => { setPrefill(r); setView('new'); }} />}
      {view === 'catalog' && <Catalog />}
      {view === 'jobs' && <Jobs />}
      {view === 'new' && <NewOne prefill={prefill} onDone={() => { setPrefill(null); setView('list'); }} />}
      {view === 'langs' && <LangList />}
    </>
  );
}

function List({ onEdit }: { onEdit: (r: Row) => void }) {
  const [f, setF] = useState({ status: 'DRAFT', lang: '', targetType: '', stale: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...f, page: String(page), size: '20' }).filter(([, v]) => v)).toString();
  const r = useApi<Page>(`/admin/i18n/translations?${qs}`);
  const a = useAct();
  const approve = (x: Row) => void a.run('ap:' + x.id, () => api(`/admin/i18n/translations/${x.id}/approve`, { method: 'POST' }), r.reload, '승인했습니다.');
  const reject = (x: Row) => {
    const reason = prompt('반려 사유(2자 이상)');
    if (!reason || reason.trim().length < 2) return;
    void a.run('rj:' + x.id, () => api(`/admin/i18n/translations/${x.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), r.reload, '반려했습니다.');
  };
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };

  return (
    <>
      <h2>번역 목록 · 승인</h2>
      <p className="hint">승인한 번역만 손님 화면에 나갑니다(다국어를 켠 뒤). 원문이 고쳐지면 「낡음」이 되어 나가지 않고, 다시 넣어 승인해야 합니다. 번역문에 차단 금칙어가 있으면 승인되지 않습니다.</p>
      <div className="row-act">
        <select value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="상태">
          <option value="">상태 전체</option>{Object.entries(ST_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={f.targetType} onChange={(e) => set('targetType', e.target.value)} aria-label="대상">
          <option value="">대상 전체</option>{Object.entries(TYPE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={f.lang} onChange={(e) => set('lang', e.target.value.trim().toLowerCase())} placeholder="언어(en)" size={6} aria-label="언어" />
        <select value={f.stale} onChange={(e) => set('stale', e.target.value)} aria-label="낡음">
          <option value="">낡음 상관없이</option><option value="true">낡은 것만</option><option value="false">낡지 않은 것만</option>
        </select>
      </div>
      <Flash msg={a.msg} err={a.err} />
      {r.error ? <ErrorView error={r.error} onRetry={r.reload} /> : !r.data ? <p className="muted">불러오는 중…</p> : r.data.items.length === 0 ? (
        <p className="muted">해당하는 번역이 없습니다.</p>
      ) : (
        <>
          <table className="tbl" data-i18n-list>
            <thead><tr><th>대상</th><th>언어</th><th>원문</th><th>번역</th><th>상태</th><th>넣은 때</th><th></th></tr></thead>
            <tbody>{r.data.items.map((x) => (
              <tr key={x.id}>
                <td>{TYPE_KO[x.targetType] ?? x.targetType} · {FIELD_KO[x.field] ?? x.field}<br /><span className="muted">{x.targetId.slice(0, 13)}</span></td>
                <td>{x.lang}</td>
                <td className="wrap">{x.sourceMissing ? <span className="bad">원문 없음</span> : x.sourceText}</td>
                <td className="wrap">{x.text}</td>
                <td>{ST_KO[x.status] ?? x.status}{x.isStale && <><br /><span className="bad">낡음</span></>}
                  {x.rejectReason && <><br /><span className="muted">{x.rejectReason}</span></>}</td>
                <td>{ymdhm(x.translatedAt)}</td>
                <td className="row-act">
                  {x.status !== 'APPROVED' && !x.isStale && !x.sourceMissing && (
                    <button className="btn-sm" disabled={a.busy === 'ap:' + x.id} onClick={() => approve(x)}>승인</button>)}
                  {x.status !== 'REJECTED' && <button className="btn-sm ghost" disabled={a.busy === 'rj:' + x.id} onClick={() => reject(x)}>반려</button>}
                  <button className="btn-sm ghost" onClick={() => onEdit(x)}>고치기</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          <p className="row-act">
            <button className="btn-sm ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
            <span>{page} / {r.data.pages} · {n(r.data.total)}건</span>
            <button className="btn-sm ghost" disabled={page >= r.data.pages} onClick={() => setPage(page + 1)}>다음</button>
          </p>
        </>
      )}
    </>
  );
}

/* ── 자동 번역 (v10.104 · 3-2) ─────────────────────────────────────── */

interface Job { id: string; targetType: string; targetId: string; lang: string; state: string; attempts: number; result: string | null; lastError: string | null; updatedAt: string; title: string | null }
interface JobPage { items: Job[]; total: number; page: number; size: number; pages: number; counts: Record<string, number>; provider: string | null }

function Jobs() {
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ state, page: String(page), size: '20' }).filter(([, v]) => v)).toString();
  const r = useApi<JobPage>(`/admin/i18n/jobs?${qs}`);
  const a = useAct();
  const retry = (x: Job) => void a.run('rt:' + x.id, () => api(`/admin/i18n/jobs/${x.id}/retry`, { method: 'POST' }), r.reload, '다시 시도합니다 — 다음 배치(1분 안)에 번역합니다.');
  const backfill = () => {
    if (!confirm('지금 손님에게 보이는 매물 · 요청을 모두 자동 번역 줄에 넣습니다. 건수만큼 비용이 듭니다(월 상한 안에서). 계속할까요?')) return;
    void a.run('bf', () => api<{ queued: number }>('/admin/i18n/jobs/backfill', { method: 'POST' }), r.reload, '넣었습니다 — 스위치가 꺼져 있으면 0건입니다.');
  };
  const c = r.data?.counts ?? {};
  return (
    <>
      <h2>자동 번역 (매물 · 요청)</h2>
      <p className="notice info">매물 · 요청이 손님에게 보이게 되면(검수 승인) · 보이는 동안 고쳐지면 번역 줄에 들어가고, 1분마다 몇 건씩 번역합니다.
        번역문에 차단 금칙어가 있으면 자동 승인하지 않고 「번역 목록」에 승인 대기로 남습니다. 사람이 승인한 번역은 덮어쓰지 않습니다.
        켜는 조건: 사이트 설정 <b>i18n.auto_translate.enabled</b> · AI 에이전트 전체 · 월 상한(AI 에이전트 화면) · 엔진 키(운영 .env).</p>
      <p className="row-act">
        <span>엔진: <b>{r.data ? (r.data.provider ?? '없음 — 아무것도 부르지 않음') : '…'}</b></span>
        {Object.keys(JOB_KO).map((k) => <span key={k} className="pill">{JOB_KO[k]} {n(c[k] ?? 0)}</span>)}
        <button className="btn-sm ghost" disabled={a.busy === 'bf'} onClick={backfill}>노출 중인 글 한꺼번에 넣기</button>
      </p>
      <div className="row-act">
        <select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} aria-label="상태">
          <option value="">상태 전체</option>{Object.entries(JOB_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <Flash msg={a.msg} err={a.err} />
      {r.error ? <ErrorView error={r.error} onRetry={r.reload} /> : !r.data ? <p className="muted">불러오는 중…</p> : r.data.items.length === 0 ? (
        <p className="muted">작업 줄이 없습니다.</p>
      ) : (
        <>
          <table className="tbl" data-i18n-jobs>
            <thead><tr><th>대상</th><th>원문 제목</th><th>언어</th><th>상태</th><th>결과</th><th>바뀐 때</th><th></th></tr></thead>
            <tbody>{r.data.items.map((x) => (
              <tr key={x.id}>
                <td>{TYPE_KO[x.targetType] ?? x.targetType}<br /><span className="muted">{x.targetId.slice(0, 13)}</span></td>
                <td className="wrap">{x.title ?? <span className="bad">원문 없음</span>}</td>
                <td>{x.lang}</td>
                <td>{JOB_KO[x.state] ?? x.state}{x.attempts > 0 && <span className="muted"> · {x.attempts}회</span>}</td>
                <td className="wrap">{x.result ? (RESULT_KO[x.result] ?? x.result) : '—'}{x.lastError && <><br /><span className="bad">{x.lastError}</span></>}</td>
                <td>{ymdhm(x.updatedAt)}</td>
                <td>{['HELD', 'FAILED', 'DONE'].includes(x.state) && (
                  <button className="btn-sm ghost" disabled={a.busy === 'rt:' + x.id} onClick={() => retry(x)}>다시 시도</button>)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="row-act">
            <button className="btn-sm ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
            <span>{page} / {r.data.pages} · {n(r.data.total)}건</span>
            <button className="btn-sm ghost" disabled={page >= r.data.pages} onClick={() => setPage(page + 1)}>다음</button>
          </p>
        </>
      )}
    </>
  );
}

/* ── 원문 목록 (v10.103 · 3-1) ─────────────────────────────────────── */

interface CatField { field: string; id?: string | null; status?: string | null; isStale?: boolean | null; text?: string | null; rejectReason?: string | null }
interface CatItem { targetId: string; label: string | null; gwanCode: string | null; fields: CatField[] }
interface CatPage { items: CatItem[]; total: number; page: number; size: number; pages: number }

/** 칸의 번역 상태 → 칩(없음 · 승인 대기 · 승인 · 낡음 · 반려) */
function chipOf(f: CatField): { text: string; cls: string } {
  if (!f.id || !f.status) return { text: '없음', cls: 'pill pill-muted' };
  if (f.isStale) return { text: '낡음', cls: 'pill pill-warning' };
  if (f.status === 'APPROVED' || f.status === 'AUTO_APPROVED') return { text: ST_KO[f.status] ?? '승인', cls: 'pill badge-verified' };
  if (f.status === 'REJECTED') return { text: '반려', cls: 'pill pill-danger' };
  if (f.status === 'DRAFT') return { text: '승인 대기', cls: 'pill badge-verified_doc' };
  return { text: ST_KO[f.status] ?? f.status, cls: 'pill pill-muted' };
}

/** 서버 오류 → 우리말 (메시지는 이미 우리말 · 금칙어는 낱말을 붙여 보여 줌) */
function errKo(e: ApiFailure): string {
  const b = e.body;
  const words = (b.details as { words?: unknown } | undefined)?.words;
  switch (b.code) {
    case 'BANNED_WORD':
      return `번역문에 차단 금칙어가 있어 승인할 수 없습니다${Array.isArray(words) && words.length ? ` — ${words.join(', ')}` : ''}. 고쳐서 다시 저장하십시오.`;
    case 'TRANSLATION_STALE': return '원문이 고쳐져 낡은 번역입니다 — 번역을 다시 저장한 뒤 승인하십시오.';
    case 'SOURCE_MISSING': return '원문이 없어져 승인할 수 없습니다.';
    case 'ALREADY_APPROVED': return '이미 승인한 번역입니다.';
    case 'LANG_UNKNOWN': case 'LANG_KO_SOURCE': return b.message || '번역할 언어를 고르십시오.';
    default: return b.message || (e.status === 409 ? '지금 상태에서는 처리할 수 없습니다.' : '처리하지 못했습니다.');
  }
}
/** api 호출을 감싸 오류 메시지를 우리말로 바꿔 useAct 에 넘김 */
async function ko<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    if (e instanceof ApiFailure) throw new ApiFailure(e.status, { ...e.body, message: errKo(e) });
    throw e;
  }
}

function Catalog() {
  const langs = useApi<Langs>('/admin/i18n/langs');
  const [targetType, setType] = useState<string>('NOTICE');
  const [lang, setLang] = useState('en');
  const [qIn, setQIn] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<{ item: CatItem; field: string } | null>(null);
  const qs = new URLSearchParams({ targetType, lang, page: String(page), size: '20', ...(q ? { q } : {}) }).toString();
  const r = useApi<CatPage>(`/admin/i18n/catalog?${qs}`);
  const active = (langs.data?.items ?? []).filter((l) => l.isActive && l.code !== 'ko');
  const langOpts = active.some((l) => l.code === lang) ? active : [...active, { code: lang, name: lang } as Lang];
  const fields = FIELDS[targetType] ?? [];
  // 목록을 다시 읽은 뒤에도 열린 편집기가 최신 칸 상태를 보도록
  const cur = sel && r.data ? r.data.items.find((x) => x.targetId === sel.item.targetId) ?? sel.item : sel?.item ?? null;

  return (
    <>
      <h2>원문 목록</h2>
      <p className="notice info" data-i18n-note>승인한 번역만 손님 화면에 나갑니다 · 원문이 고쳐지면 낡음으로 바뀌어 원문이 나갑니다 · 약관 번역은 손님 화면에 『참고용 번역 · 한국어본 우선』이 붙습니다</p>
      <div className="row-act">
        <select value={targetType} onChange={(e) => { setType(e.target.value); setPage(1); setSel(null); }} aria-label="대상">
          {CATALOG_TYPES.map((k) => <option key={k} value={k}>{TYPE_KO[k]}</option>)}
        </select>
        <select value={lang} onChange={(e) => { setLang(e.target.value); setPage(1); setSel(null); }} aria-label="언어">
          {langOpts.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.code})</option>)}
        </select>
        <form className="row-act" onSubmit={(e) => { e.preventDefault(); setQ(qIn.trim()); setPage(1); setSel(null); }}>
          <input value={qIn} onChange={(e) => setQIn(e.target.value)} placeholder="제목 · 이름 찾기" maxLength={50} aria-label="찾기" />
          <button type="submit" className="btn-sm ghost">찾기</button>
          {q && <button type="button" className="btn-sm ghost" onClick={() => { setQIn(''); setQ(''); setPage(1); setSel(null); }}>지우기</button>}
        </form>
      </div>
      {!langs.data && !langs.error ? null : active.length === 0 && <p className="hint">켜진 번역 언어가 없습니다 — 「언어」 탭에서 켜면 고를 수 있습니다(번역은 미리 넣어 둘 수 있습니다).</p>}
      {sel && cur && (
        <Editor key={`${cur.targetId}:${sel.field}:${lang}`} targetType={targetType} lang={lang} item={cur} field={sel.field}
          onChanged={r.reload} onClose={() => setSel(null)} />
      )}
      {r.error ? <ErrorView error={r.error} onRetry={r.reload} /> : !r.data ? <p className="muted">불러오는 중…</p> : r.data.items.length === 0 ? (
        <p className="muted">해당하는 원문이 없습니다.</p>
      ) : (
        <>
          <table className="tbl" data-i18n-catalog>
            <thead><tr><th>원문</th><th>관</th>{fields.map((k) => <th key={k}>{FIELD_KO[k] ?? k}</th>)}</tr></thead>
            <tbody>{r.data.items.map((x) => (
              <tr key={x.targetId}>
                <td className="wrap">{x.label ?? '—'}<br /><span className="muted">{x.targetId.length > 20 ? x.targetId.slice(0, 13) : x.targetId}</span></td>
                <td>{x.gwanCode ?? '—'}</td>
                {fields.map((k) => {
                  const f = x.fields.find((y) => y.field === k) ?? { field: k };
                  const c = chipOf(f);
                  const on = sel?.item.targetId === x.targetId && sel.field === k;
                  return (
                    <td key={k}>
                      <button type="button" className={`btn-sm ${on ? '' : 'ghost'}`} onClick={() => setSel({ item: x, field: k })}
                        title={f.text ?? '번역 넣기'} aria-label={`${x.label ?? x.targetId} ${FIELD_KO[k] ?? k} 번역`}>
                        <span className={c.cls}>{c.text}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table>
          <p className="row-act">
            <button className="btn-sm ghost" disabled={page <= 1} onClick={() => { setPage(page - 1); setSel(null); }}>이전</button>
            <span>{page} / {r.data.pages} · {n(r.data.total)}건</span>
            <button className="btn-sm ghost" disabled={page >= r.data.pages} onClick={() => { setPage(page + 1); setSel(null); }}>다음</button>
          </p>
        </>
      )}
    </>
  );
}

function Editor({ targetType, lang, item, field, onChanged, onClose }: {
  targetType: string; lang: string; item: CatItem; field: string; onChanged: () => void; onClose: () => void;
}) {
  const f = item.fields.find((y) => y.field === field) ?? { field };
  const src = useApi<{ sourceText: string; gwanCode: string | null }>(
    `/admin/i18n/source?${new URLSearchParams({ targetType, targetId: item.targetId, field })}`);
  // 목록(catalog)이 번역문 전체 · 반려 사유를 함께 줍니다
  const curText = f.text ?? null;
  const [text, setText] = useState<string | null>(null);
  const value = text ?? curText ?? '';
  const a = useAct();
  const c = chipOf(f);
  const after = () => { setText(null); onChanged(); };
  const save = () => {
    if (!value.trim()) { a.setErr('번역을 적으십시오.'); return; }
    void a.run('save', () => ko(api('/admin/i18n/translations', { method: 'PUT',
      body: JSON.stringify({ targetType, targetId: item.targetId, field, lang, text: value.trim() }) })), after, '저장했습니다 — 승인 대기입니다.');
  };
  const approve = () => f.id && void a.run('ap', () => ko(api(`/admin/i18n/translations/${f.id}/approve`, { method: 'POST' })), after, '승인했습니다.');
  const reject = () => {
    if (!f.id) return;
    const reason = prompt('반려 사유(2자 이상)');
    if (!reason || reason.trim().length < 2) { if (reason !== null) a.setErr('반려 사유를 2자 이상 적으십시오.'); return; }
    void a.run('rj', () => ko(api(`/admin/i18n/translations/${f.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) })), after, '반려했습니다.');
  };
  const isDraft = !!f.id && f.status === 'DRAFT';

  return (
    <div className="card pad" data-i18n-editor>
      <p className="row-act">
        <b>{TYPE_KO[targetType] ?? targetType} · {FIELD_KO[field] ?? field} · {lang}</b>
        <span className={c.cls}>{c.text}</span>
        <span className="muted">{item.label ?? item.targetId}</span>
        <button type="button" className="btn-sm ghost" onClick={onClose}>닫기</button>
      </p>
      {targetType === 'TERM' && <p className="hint">약관 번역은 손님 화면에 『참고용 번역 · 한국어본 우선』이 붙습니다.</p>}
      <p className="hint">금액 · 수수료 · 날짜는 원문 값 그대로 적으십시오. 저장하면 다시 「승인 대기」가 됩니다.</p>
      <div className="wrap"><b>한국어 원문</b><br />
        {src.error ? <ErrorView error={src.error} onRetry={src.reload} /> : !src.data ? <span className="muted">불러오는 중…</span>
          : <span style={{ whiteSpace: 'pre-wrap' }}>{src.data.sourceText}</span>}
      </div>
      <div className="wrap"><b>지금 번역</b><br />
        {curText ? <span style={{ whiteSpace: 'pre-wrap' }}>{curText}</span> : <span className="muted">없음</span>}
        {f.isStale && <><br /><span className="bad">원문이 고쳐졌습니다 — 다시 저장한 뒤 승인하십시오.</span></>}
        {f.rejectReason && <><br /><span className="muted">반려 사유: {f.rejectReason}</span></>}
      </div>
      <Flash msg={a.msg} err={a.err} />
      <label className="block">번역<textarea rows={6} value={value} onChange={(e) => setText(e.target.value)} /></label>
      <p className="row-act">
        <button disabled={!!a.busy} onClick={save}>저장(승인 대기)</button>
        {isDraft && <button className="btn-sm" disabled={!!a.busy || !!f.isStale} onClick={approve}>승인</button>}
        {isDraft && <button className="btn-sm ghost" disabled={!!a.busy} onClick={reject}>반려(사유)</button>}
      </p>
    </div>
  );
}

function NewOne({ prefill, onDone }: { prefill: Partial<Row> | null; onDone: () => void }) {
  const [f, setF] = useState({
    targetType: prefill?.targetType ?? 'NOTICE', targetId: prefill?.targetId ?? '',
    field: prefill?.field ?? 'title', lang: prefill?.lang ?? 'en', text: prefill?.text ?? '',
  });
  const [src, setSrc] = useState<string | null>(prefill?.sourceText ?? null);
  const a = useAct();
  const load = () => void a.run('src', () => api<{ sourceText: string }>(
    `/admin/i18n/source?${new URLSearchParams({ targetType: f.targetType, targetId: f.targetId.trim(), field: f.field })}`),
    undefined, '원문을 불러왔습니다.').then((r) => { if (r) setSrc(r.sourceText); });
  const save = () => {
    if (!f.targetId.trim() || !f.text.trim()) { a.setErr('대상 번호와 번역을 적으십시오.'); return; }
    void a.run('save', () => api('/admin/i18n/translations', { method: 'PUT', body: JSON.stringify({ ...f, targetId: f.targetId.trim(), text: f.text.trim() }) }),
      onDone, '넣었습니다 — 목록에서 승인하십시오.');
  };
  const typeChange = (t: string) => setF({ ...f, targetType: t, field: FIELDS[t]![0]! });

  return (
    <>
      <h2>번역 넣기</h2>
      <p className="hint">지금 엔진은 MANUAL — 운영자가 번역을 직접 넣습니다. 넣거나 고치면 다시 「승인 대기」가 됩니다. 약관의 번호는 「code@version」입니다. 금액 · 수수료 · 날짜는 원문 값 그대로 적으십시오.</p>
      <Flash msg={a.msg} err={a.err} />
      <div className="form-grid" data-i18n-form>
        <label>대상<select value={f.targetType} onChange={(e) => typeChange(e.target.value)}>
          {Object.entries(TYPE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>칸<select value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })}>
          {FIELDS[f.targetType]!.map((k) => <option key={k} value={k}>{FIELD_KO[k] ?? k}</option>)}</select></label>
        <label>대상 번호<input value={f.targetId} onChange={(e) => setF({ ...f, targetId: e.target.value })} placeholder="번호(uuid) · 약관은 code@version" /></label>
        <label>언어<input value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value.trim().toLowerCase() })} size={4} /></label>
      </div>
      <p><button className="btn-sm ghost" disabled={!f.targetId.trim() || a.busy === 'src'} onClick={load}>원문 불러오기</button></p>
      {src !== null && <div className="card wrap"><b>원문</b><br />{src}</div>}
      <label className="block">번역<textarea rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
      <p><button disabled={a.busy === 'save'} onClick={save}>넣기</button> <button className="ghost" onClick={onDone}>취소</button></p>
    </>
  );
}

function LangList() {
  const r = useApi<Langs>('/admin/i18n/langs');
  const a = useAct();
  const toggle = (l: Lang) => void a.run('l:' + l.code, () => api(`/admin/i18n/langs/${l.code}`, { method: 'POST', body: JSON.stringify({ isActive: !l.isActive }) }),
    r.reload, l.isActive ? '껐습니다.' : '켰습니다.');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  return (
    <>
      <h2>언어</h2>
      <div className="kpi4">
        <div><b className={d.enabled ? 'good' : ''}>{d.enabled ? '켜짐' : '꺼짐'}</b><span>다국어(i18n.enabled)</span></div>
        <div><b>{d.engine ?? '—'}</b><span>번역 엔진</span></div>
        <div><b>{d.items.filter((x) => x.isActive).length}</b><span>켜진 언어</span></div>
        <div><b>{n(d.items.reduce((s, x) => s + x.translations, 0))}</b><span>번역 줄</span></div>
      </div>
      <p className="hint">다국어 전체 켜기는 정책(site_settings)의 i18n.enabled 입니다 — 오픈 뒤 켭니다(docs/148). 여기서 켠 언어만 손님이 고를 수 있습니다. 한국어(원문)는 끌 수 없습니다. 아랍어는 화면 좌우 반전 작업 뒤에 켭니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl" data-i18n-langs>
        <thead><tr><th>코드</th><th>이름</th><th>그 언어로</th><th>번역 줄</th><th>상태</th><th></th></tr></thead>
        <tbody>{d.items.map((l) => (
          <tr key={l.code}>
            <td>{l.code}</td><td>{l.name}{l.rtl && <span className="muted"> · 좌우 반전</span>}</td><td>{l.native}</td>
            <td className="num-cell">{n(l.translations)}</td><td>{l.isActive ? '켜짐' : '꺼짐'}</td>
            <td>{l.code !== 'ko' && <button className="btn-sm ghost" disabled={a.busy === 'l:' + l.code} onClick={() => toggle(l)}>{l.isActive ? '끄기' : '켜기'}</button>}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
