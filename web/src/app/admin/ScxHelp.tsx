/* ===== v10.594 (docs/736) ⑩ 화면 도움말 — web/src/app/admin/ScxHelp.tsx 새 파일 =====
 * 관 관리 › 화면 도움말(SB-ADM-SCX-020)
 *   ADMIN · SUPER  운영 화면 도움말(ADMIN_GUIDE) 지금 판 · 절 목차(탭 키) · 판 목록 · 탭 ↔ 절 이은 것
 *   SUPER          새 판 저장(옛 판은 남음) · 잇기 지우기(잇기는 탭 제목 옆 「?」에서)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface Guide {
  code: string; maxChars: number; canEdit: boolean;
  current: { version: number; title: string; body: string; updatedAt: string; sections: Array<{ id: string; heading: string; key: string | null }> } | null;
  versions: Array<{ version: number; chars: number; note: string | null; by: string | null; createdAt: string }>;
}
interface Links { items: Array<{ tabKey: string; docCode: string; heading: string; by: string | null; updatedAt: string }> }

export function ScxHelp() {
  const g = useApi<Guide>('/admin/help/guide');
  const l = useApi<Links>('/admin/help/tab-links');
  const a = useAct();
  const [body, setBody] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const d = g.data;
  if (!d) return <p className="muted">불러오는 중…</p>;
  const cur = d.current;
  return (
    <section data-scx-help="" data-scx-help-version={cur?.version ?? 0}>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-nt info">탭 제목 옆 「?」를 누르면 이 글의 절이 보입니다. 절 제목 끝에 <span className="mono">[탭 키]</span>를 적으면 그 탭과 이어집니다(예: <span className="mono">### 운영 알림 [ops-alerts]</span>). 회원용 사용자 설명서(AI 상담이 읽는 글)는 따로입니다.</div>
      <table className="tbl"><tbody>
        <tr><th>지금 판</th><td>{cur ? `${cur.version}판 · ${ymdhm(cur.updatedAt)} · 절 ${cur.sections.length}개 · ${cur.body.length.toLocaleString('ko-KR')} / ${d.maxChars.toLocaleString('ko-KR')}자` : '없음'}</td></tr>
        <tr><th>탭 키가 있는 절</th><td className="mono">{cur?.sections.filter((s) => s.key).map((s) => s.key).join(' · ') || '—'}</td></tr>
      </tbody></table>
      {d.canEdit && (body == null ? (
        <p><button className="btn-sm" data-scx-help-edit="" onClick={() => setBody(cur?.body ?? '')}>도움말 고치기(새 판)</button></p>
      ) : (
        <div data-scx-help-form="">
          <textarea className="inp" rows={18} style={{ width: '100%' }} value={body} onChange={(e) => setBody(e.target.value)} />
          <p>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="고친 까닭(선택 · 200자)" />{' '}
            <button className="btn-sm" disabled={!!a.busy} data-scx-help-save="" onClick={() => void a.run('save', () => api('/admin/help/guide', { method: 'POST', body: JSON.stringify({ body, note }) }), () => { setBody(null); setNote(''); g.reload(); })}>저장</button>{' '}
            <button className="btn-sm btn-plain" onClick={() => setBody(null)}>닫기</button>
          </p>
        </div>
      ))}
      <h3>탭 ↔ 절 이은 것</h3>
      <table className="tbl" data-scx-links={l.data?.items.length ?? 0}>
        <thead><tr><th>탭 키</th><th>설명서</th><th>절</th><th>고친 사람</th><th /></tr></thead>
        <tbody>{(l.data?.items ?? []).length === 0 ? <tr><td colSpan={5} className="muted">이은 것이 없습니다 — 절 제목의 [탭 키] · 탭 이름으로 찾습니다.</td></tr> : l.data!.items.map((r) => (
          <tr key={r.tabKey}><td className="mono">{r.tabKey}</td><td>{r.docCode === 'ADMIN_GUIDE' ? '운영 화면 도움말' : '사용자 설명서'}</td><td>{r.heading}</td><td className="mono">{r.by ?? '—'} · {ymdhm(r.updatedAt)}</td>
            <td>{d.canEdit && <button className="btn-sm btn-plain" onClick={() => void a.run('rm', () => api(`/admin/help/tab-links/${r.tabKey}/remove`, { method: 'POST' }), l.reload)}>지우기</button>}</td></tr>
        ))}</tbody>
      </table>
      <h3>판 목록</h3>
      <table className="tbl"><thead><tr><th>판</th><th>글자</th><th>까닭</th><th>고친 사람</th><th>때</th></tr></thead>
        <tbody>{d.versions.map((v) => <tr key={v.version}><td>{v.version}</td><td>{v.chars.toLocaleString('ko-KR')}</td><td>{v.note ?? '—'}</td><td className="mono">{v.by ?? '—'}</td><td>{ymdhm(v.createdAt)}</td></tr>)}</tbody></table>
    </section>
  );
}
