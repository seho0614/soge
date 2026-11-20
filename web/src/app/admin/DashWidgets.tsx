/**
 * v10.536 (D282 · docs/674) 운영 대시보드 위젯 배치 — SB-ADM-DTX-020
 *   DashSlots  대시보드(SummaryView)가 카드 조각을 열쇠별로 넘기면, 이 계정에 저장한 차례 · 숨김대로 그림
 *              저장한 배치가 없거나 불러오지 못하면 **기본 배치 그대로**(넘긴 차례 = DASH_WIDGETS 차례)
 *   DashEditor 「첫 화면 꾸미기」 — 카드마다 위 · 아래 · 보이기 · 저장(PUT /admin/dash-layout) · 기본으로(DELETE)
 * 카드 열쇠 목록은 서버 src/modules/dtx/dash-layout.ts 의 DASH_WIDGETS 와 같아야 함(test_v1536 이 대조)
 * 글자 12 · 13 · 14px · 모서리 var(--r-sm) · # 색 없음(다크 모드 토큰 그대로)
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useAct } from '../../lib/act';
import { Flash } from '../../components/Flash';

export const DASH_WIDGETS: Array<[string, string]> = [
  ['todo', '오늘 할 일'], ['notices', '관리자 공지'], ['launch', '공개 직후 지켜보기'], ['state', '운영 상태 한눈에'],
  ['owner', '대표 할 일'], ['release', '지금 판 · 적용 기록'], ['apply', '운영 적용 확인표'], ['acct', '이번 달 매출 · 이익(SUPER)'],
  ['server', '서버 자원 추세'], ['tiles', '처리 대기 숫자'], ['cap', '검수 처리 여력'], ['alerts', '확인이 필요한 것'],
  ['cs', '고객센터 한눈에'], ['runway', '활주로'], ['more', '다른 운영 화면'],
];
export const DASH_DEFAULT = DASH_WIDGETS.map(([k]) => k);
const labelOf = (k: string) => DASH_WIDGETS.find(([x]) => x === k)?.[1] ?? k;

interface Layout { saved: boolean; order: string[]; hidden: string[]; updatedAt: string | null }

/** 저장한 차례 + 빠진 카드는 기본 차례대로 끝에(모르는 열쇠는 버림) */
export function mergeOrder(saved: string[] | undefined): string[] {
  const out = (saved ?? []).filter((k) => DASH_DEFAULT.includes(k));
  for (const k of DASH_DEFAULT) if (!out.includes(k)) out.push(k);
  return out;
}

export function DashSlots({ parts }: { parts: Record<string, ReactNode> }) {
  const [lay, setLay] = useState<Layout>({ saved: false, order: DASH_DEFAULT, hidden: [], updatedAt: null });
  const [edit, setEdit] = useState(false);
  useEffect(() => {
    api<Layout>('/admin/dash-layout').then((r) => setLay({ ...r, order: mergeOrder(r.order), hidden: (r.hidden ?? []).filter((k) => DASH_DEFAULT.includes(k)) }))
      .catch(() => undefined);   // 못 불러오면 기본 배치 그대로
  }, []);
  const shown = lay.order.filter((k) => !lay.hidden.includes(k) && k in parts);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8 }} data-dash-layout={lay.saved ? 'saved' : 'default'}>
        {lay.saved && <small className="dim">내 배치 · 숨김 {lay.hidden.length}</small>}
        <button className="btn-sm btn-plain" onClick={() => setEdit((v) => !v)} data-dash-edit="">{edit ? '꾸미기 닫기' : '첫 화면 꾸미기'}</button>
      </div>
      {edit && <DashEditor lay={lay} onSaved={(l) => { setLay(l); setEdit(false); }} />}
      {shown.map((k) => <Fragment key={k}>{parts[k]}</Fragment>)}
    </>
  );
}

function DashEditor({ lay, onSaved }: { lay: Layout; onSaved: (l: Layout) => void }) {
  const a = useAct();
  const [order, setOrder] = useState<string[]>(lay.order);
  const [hidden, setHidden] = useState<string[]>(lay.hidden);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };
  const toggle = (k: string) => setHidden(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]);
  const save = () => void a.run('save', () => api<Layout & { note: string }>('/admin/dash-layout', { method: 'PUT', body: JSON.stringify({ order, hidden }) }), undefined, (r) => {
    if (r) onSaved({ saved: true, order: mergeOrder(r.order), hidden: r.hidden ?? [], updatedAt: r.updatedAt ?? null });
    return r?.note ?? '저장했습니다.';
  });
  const reset = () => {
    if (!confirm('첫 화면을 기본 배치(모든 카드 · 처음 차례)로 되돌릴까요?')) return;
    void a.run('reset', () => api<Layout & { note: string }>('/admin/dash-layout', { method: 'DELETE' }), undefined, (r) => {
      onSaved({ saved: false, order: DASH_DEFAULT, hidden: [], updatedAt: null });
      return r?.note ?? '기본 배치로 되돌렸습니다.';
    });
  };
  return (
    <div className="card pad" data-dash-editor="">
      <Flash msg={a.msg} err={a.err} />
      <b>첫 화면 꾸미기</b> <small className="dim">이 계정에만 저장됩니다 — 다른 운영자의 첫 화면은 그대로입니다. 권한이 없는 카드는 고르더라도 나오지 않습니다.</small>
      <ol style={{ margin: '8px 0', paddingLeft: 20 }}>
        {order.map((k, i) => (
          <li key={k} data-dash-item={k} style={{ fontSize: 14, padding: '2px 0', opacity: hidden.includes(k) ? 0.55 : 1 }}>
            <label><input type="checkbox" checked={!hidden.includes(k)} onChange={() => toggle(k)} data-dash-show={k} /> {labelOf(k)}</label>{' '}
            <button className="btn-sm btn-plain" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${labelOf(k)} 위로`}>▲</button>{' '}
            <button className="btn-sm btn-plain" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`${labelOf(k)} 아래로`}>▼</button>
          </li>
        ))}
      </ol>
      <button className="btn-sm btn-ok" disabled={a.busy === 'save' || hidden.length >= order.length} onClick={save} data-dash-save="">저장</button>{' '}
      <button className="btn-sm btn-plain" disabled={a.busy === 'reset'} onClick={reset} data-dash-reset="">기본으로</button>
      {hidden.length >= order.length && <small className="dim"> 카드를 하나 이상 남기십시오.</small>}
    </div>
  );
}
