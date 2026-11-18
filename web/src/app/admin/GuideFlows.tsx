import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { siteHref } from '../../lib/siteUrl';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { VersionHistory } from './VersionHistory';   // v10.351 (docs/485) 지난 판

interface Flow {
  code: string; version: number; titleKo: string; whoKo: string; stepsKo: string[]; titleEn: string | null; whoEn: string | null; stepsEn: string[] | null;
  href: string; sortOrder: number; isActive: boolean; updatedAt: string; by: string | null; versions: number;
}
interface Data { rows: Flow[]; canEdit: boolean }
interface Form { code: string; isNew: boolean; titleKo: string; whoKo: string; stepsKo: string; titleEn: string; whoEn: string; stepsEn: string; href: string; isActive: boolean }

/**
 * SB-ADM-SIT-120 이용 흐름 (v10.347 · D233 · docs/481)
 *
 * 대표 11/18 「다음개발」 → ③. 사용자 웹 이용안내 › 「이렇게 이용하세요」(/guide/flows)의 흐름 글을 여기서 고칩니다.
 * 고치기는 SUPER — 저장하면 새 판(옛 판은 남음 · 지우기 없음 · 숨기기는 「보임」을 끄고 저장). 단계는 한 줄에 하나.
 * 영어를 비우면 사용자 웹 영어 화면은 처음 사전 글을 씁니다. 바로 가기는 사이트 안 주소(/ 로 시작)만.
 */
export function GuideFlows() {
  const q = useApi<Data>('/admin/guide-flows');
  const a = useAct();
  const [edit, setEdit] = useState<Form | null>(null);
  const [hist, setHist] = useState<string | null>(null);   /* v10.351 지난 판을 연 흐름 */
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const { rows, canEdit } = q.data;

  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const toForm = (f: Flow): Form => ({
    code: f.code, isNew: false, titleKo: f.titleKo, whoKo: f.whoKo, stepsKo: f.stepsKo.join('\n'),
    titleEn: f.titleEn ?? '', whoEn: f.whoEn ?? '', stepsEn: (f.stepsEn ?? []).join('\n'), href: f.href, isActive: f.isActive,
  });
  const save = () => {
    if (!edit) return;
    const body = {
      titleKo: edit.titleKo, whoKo: edit.whoKo, stepsKo: lines(edit.stepsKo),
      titleEn: edit.titleEn, whoEn: edit.whoEn, stepsEn: lines(edit.stepsEn), href: edit.href, isActive: edit.isActive,
    };
    void a.run('save', () => api(`/admin/guide-flows/${edit.code.trim()}`, { method: 'POST', body: JSON.stringify(body) }), () => { setEdit(null); q.reload(); });
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEdit((e) => (e ? { ...e, [k]: v } : e));

  return (
    <section data-guide-flows={rows.length}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        흐름 <b>{rows.filter((r) => r.isActive).length}</b>개 보임 · 숨김 {rows.filter((r) => !r.isActive).length}개 ·{' '}
        <a href={siteHref('/guide/flows')} target="_blank" rel="noreferrer">사용자 웹에서 보기</a>
        {canEdit && <> · <button className="btn-sm" onClick={() => setEdit({ code: '', isNew: true, titleKo: '', whoKo: '', stepsKo: '', titleEn: '', whoEn: '', stepsEn: '', href: '/', isActive: true })} data-guide-flow-new="">새 흐름</button></>}
      </p>
      {edit && (
        <div className="card" data-guide-flow-form={edit.isNew ? 'new' : edit.code}>
          <h3 className="sec">{edit.isNew ? '새 흐름' : `「${edit.titleKo}」 새 판`}</h3>
          {edit.isNew && <p><label>코드 <input name="gf-code" value={edit.code} onChange={(e) => set('code', e.target.value)} placeholder="소문자 2 ~ 20자(예: refund)" /></label></p>}
          <p>
            <label>제목 <input name="gf-title" value={edit.titleKo} onChange={(e) => set('titleKo', e.target.value)} maxLength={60} /></label>{' '}
            <label>누가 <input name="gf-who" value={edit.whoKo} onChange={(e) => set('whoKo', e.target.value)} maxLength={60} /></label>{' '}
            <label>바로 가기 <input name="gf-href" value={edit.href} onChange={(e) => set('href', e.target.value)} maxLength={120} placeholder="/signup" /></label>{' '}
            <label><input type="checkbox" name="gf-active" checked={edit.isActive} onChange={(e) => set('isActive', e.target.checked)} /> 사용자 웹에 보임</label>
          </p>
          <p><textarea name="gf-steps" value={edit.stepsKo} onChange={(e) => set('stepsKo', e.target.value)} rows={6} style={{ width: '100%' }} placeholder="단계 — 한 줄에 하나(1 ~ 10줄 · 한 줄 2 ~ 200자)" /></p>
          <details>
            <summary>영어(비우면 처음 사전 글)</summary>
            <p>
              <label>Title <input name="gf-title-en" value={edit.titleEn} onChange={(e) => set('titleEn', e.target.value)} maxLength={100} /></label>{' '}
              <label>Who <input name="gf-who-en" value={edit.whoEn} onChange={(e) => set('whoEn', e.target.value)} maxLength={100} /></label>
            </p>
            <p><textarea name="gf-steps-en" value={edit.stepsEn} onChange={(e) => set('stepsEn', e.target.value)} rows={6} style={{ width: '100%' }} placeholder="Steps — one per line (same count as Korean)" /></p>
          </details>
          <p>
            <button className="btn-ok" disabled={a.busy === 'save'} onClick={save} data-guide-flow-save="">새 판 저장</button>{' '}
            <button className="btn-plain btn-sm" onClick={() => setEdit(null)}>취소</button>
          </p>
        </div>
      )}
      {rows.map((f) => (
        <details key={f.code} className="card" data-guide-flow-row={f.code}>
          <summary className={f.isActive ? undefined : 'muted'}>
            <b>{f.titleKo}</b> <span className="badge">{f.whoKo}</span> <small className="dim">{f.version}판{f.isActive ? '' : ' · 숨김'}{f.stepsEn ? ' · 영어 있음' : ''}</small>
          </summary>
          <ol>{f.stepsKo.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="dim">
            바로 가기 <code>{f.href}</code> · {ymdhm(f.updatedAt)}{f.by ? ` · ${f.by}` : ''} · 판 {f.versions}개
            {canEdit && <> · <button className="btn-sm" onClick={() => setEdit(toForm(f))} data-guide-flow-edit={f.code}>고치기</button></>}
            {' · '}<button className="btn-sm btn-plain" onClick={() => setHist(hist === f.code ? null : f.code)} data-guide-flow-hist={f.code}>{hist === f.code ? '지난 판 닫기' : '지난 판'}</button>
          </p>
          {hist === f.code && (
            <VersionHistory path={`/admin/guide-flows/${f.code}/versions`} current={f.version} canRestore={canEdit} onDone={q.reload}
              lines={(r) => [`제목: ${String(r.titleKo)}`, `누가: ${String(r.whoKo)}`, ...((r.stepsKo as string[]) ?? []).map((x, i) => `${i + 1}. ${x}`), `바로 가기: ${String(r.href)}`,
                r.isActive ? '' : '숨김', r.titleEn ? `영어: ${String(r.titleEn)}` : '', ...((r.stepsEn as string[] | null) ?? []).map((x, i) => `EN ${i + 1}. ${x}`)]}
              restore={(r) => api(`/admin/guide-flows/${f.code}`, { method: 'POST', body: JSON.stringify({
                titleKo: r.titleKo, whoKo: r.whoKo, stepsKo: r.stepsKo, titleEn: r.titleEn ?? '', whoEn: r.whoEn ?? '', stepsEn: r.stepsEn ?? [], href: r.href, isActive: r.isActive }) })} />
          )}
        </details>
      ))}
      <div className="ad-nt info">
        저장하면 사용자 웹 이용안내 › 「이렇게 이용하세요」에 바로 나갑니다. 금액 · 요율은 적지 말고 「화면에 나온 …을 따름」으로 씁니다(바뀌어도 고칠 필요 없게).
      </div>
    </section>
  );
}
