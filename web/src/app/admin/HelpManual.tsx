import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { siteHref } from '../../lib/siteUrl';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Ver { version: number; chars: number; note: string | null; by: string | null; createdAt: string }
interface Data {
  code: string; maxChars: number;
  current: { version: number; title: string; body: string; chars: number; updatedAt: string; sections: number } | null;
  versions: Ver[];
}

/**
 * SB-ADM-SIT-090 사용자 설명서 (v10.203 · D180 · docs/324)
 *
 * 대표 11/6 「사용자 설명서는 AI 학습」 → 「설명서 본문을 AI 자료로 통째」.
 * 사용자 웹 /guide/manual 에 나가고 AI 상담이 FAQ · 공지 · 약관과 따로 읽습니다(2만 자까지 · 10분 안에 새 판).
 * 「### 제목」 한 줄이 한 절 — AI 답의 출처 · 화면 목차가 됩니다. 저장은 SUPER(새 판 · 옛 판은 남음).
 */
export function HelpManual() {
  const q = useApi<Data>('/admin/help/manual');
  const a = useAct();
  const isSuper = tokenRoles().includes('SUPER');
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [old, setOld] = useState<{ version: number; body: string } | null>(null);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const { current, versions, maxChars } = q.data;
  const text = draft ?? current?.body ?? '';
  const chars = text.replace(/\r\n/g, '\n').trim().length + 1;
  const sections = text.split('\n').filter((l) => /^###\s+\S/.test(l)).length;
  const over = chars > maxChars;
  const save = () => {
    if (!confirm(`사용자 설명서를 새 판으로 저장합니다(${chars.toLocaleString('ko-KR')}자 · 절 ${sections}개). 사용자 웹에 바로 나가고 AI 상담은 10분 안에 새 판을 읽습니다.`)) return;
    void a.run('save', () => api('/admin/help/manual', { method: 'POST', body: JSON.stringify({ body: text, note }) }),
      () => { setDraft(null); setNote(''); q.reload(); });
  };
  const showOld = (v: number) => void api<{ version: number; body: string }>(`/admin/help/manual/versions/${v}`)
    .then(setOld).catch(() => a.setErr('그 판을 불러오지 못했습니다.'));

  return (
    <section data-help-manual="">
      <Flash msg={a.msg} err={a.err} />
      <p data-help-current="">
        {current
          ? <>지금 <b>{current.version}판</b> · {current.chars.toLocaleString('ko-KR')}자 / {maxChars.toLocaleString('ko-KR')}자 · 절 {current.sections}개 · {ymdhm(current.updatedAt)}{' '}
              · <a href={siteHref('/guide/manual')} target="_blank" rel="noreferrer">사용자 웹에서 보기</a></>
          : <span className="warn-text">설명서가 아직 없습니다.</span>}
      </p>
      <textarea name="help-body" value={text} readOnly={!isSuper} onChange={(e) => setDraft(e.target.value)}
        rows={24} style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }} data-help-body="" />
      <p data-help-count={chars} className={over ? 'warn-text' : 'muted'}>
        {chars.toLocaleString('ko-KR')}자 / {maxChars.toLocaleString('ko-KR')}자 · 절 {sections}개
        {over && ' — 한도를 넘어 저장할 수 없습니다(AI 상담이 읽는 양)'}
        {!sections && ' — 「### 제목」 절이 하나는 있어야 합니다'}
      </p>
      {isSuper ? (
        <p>
          <input name="help-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="고친 까닭(선택)" style={{ width: '50%' }} />{' '}
          <button className="btn-ok" disabled={a.busy === 'save' || draft === null || over || !sections} onClick={save} data-help-save="">새 판으로 저장</button>{' '}
          {draft !== null && <button className="btn-plain btn-sm" onClick={() => setDraft(null)}>고친 것 버리기</button>}
        </p>
      ) : <p className="muted">고치기는 최고 관리자(SUPER)만 합니다.</p>}
      <div className="ad-nt info">
        「## 장」 · 「### 절」 · 「- 목록」 · 「1. 순서」 · 표(| 칸 |) · <b>**굵게**</b> · `주소` 를 씁니다. 절은 따로 읽혀도 뜻이 통하게(「위에서 말한」 같은 말 없이) ·
        금액 · 기한 · 법률 문구는 화면 · 약관을 따르게 적습니다. 외부 연동이 끝나지 않은 기능은 「준비 중」으로.
      </div>

      <h3 className="sec">판 <em>{versions.length}</em></h3>
      <table className="tbl" data-help-versions="">
        <thead><tr><th>판</th><th>글자</th><th>고친 까닭</th><th>고친 사람</th><th>시각</th><th /></tr></thead>
        <tbody>{versions.map((v) => (
          <tr key={v.version}>
            <td>{v.version}</td><td className="num-cell">{v.chars.toLocaleString('ko-KR')}</td><td>{v.note ?? '—'}</td>
            <td className="muted">{v.by ?? '—'}</td><td className="muted">{ymdhm(v.createdAt)}</td>
            <td><button className="btn-plain btn-sm" onClick={() => showOld(v.version)}>보기</button></td>
          </tr>))}</tbody>
      </table>
      {old && (
        <div className="card pad" data-help-old={old.version}>
          <p><b>{old.version}판</b>{' '}
            {isSuper && <button className="btn-sm" onClick={() => { setDraft(old.body); setOld(null); }}>이 판 내용을 고치는 칸에 넣기</button>}{' '}
            <button className="btn-plain btn-sm" onClick={() => setOld(null)}>닫기</button></p>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>{old.body}</pre>
        </div>
      )}
    </section>
  );
}
