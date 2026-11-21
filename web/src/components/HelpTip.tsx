/* ===== v10.594 (docs/736) ⑩ 운영 화면 「?」 도움말 — web/src/components/HelpTip.tsx 새 파일 =====
 *   탭 제목(h1) 줄 오른쪽 「?」(h1 밖) → GET /admin/help/tab?key=&label= → 운영 화면 도움말(ADMIN_GUIDE) · 사용자 설명서 절 하나를 그 자리에 펼침.
 *   누를 때만 부름(탭을 옮길 때마다 부르지 않음) · 못 불러오면 「불러오지 못했습니다」만(화면은 그대로).
 *   SUPER: 절이 없거나 다르면 이을 절을 골라 PUT /admin/help/tab-links/{key}.
 *   모양: 제목 글자 크기를 따르지 않게 14px · 모서리 var(--r-md) · 색은 토큰만(app.css 를 고치지 않음 · AdminTree · 상단바 안 고침).
 */
import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../lib/api';

interface TabHelp {
  key: string; found: boolean; docCode: string | null; version: number | null; via: string | null;
  section: { id: string; heading: string; text: string } | null;
  linked: { docCode: string; heading: string; broken: boolean } | null;
  choices: Array<{ docCode: string; heading: string }>; canEdit: boolean; note: string | null;
}

/** 아주 작은 글 그리기 — 줄 · 「- 」 목록 · **굵게** 만(HTML 은 그리지 않음) */
function Lines({ text }: { text: string }) {
  return (
    <>{text.split('\n').filter((l) => l.trim() !== '').map((l, i) => {
      const li = /^\s*[-*]\s+/.test(l);
      const parts = l.replace(/^\s*[-*]\s+/, '').split(/\*\*(.+?)\*\*/g);
      const body = parts.map((p, j) => (j % 2 ? <b key={j}>{p}</b> : <span key={j}>{p}</span>));
      return <span key={i} style={{ display: 'block', paddingLeft: li ? 14 : 0 }}>{li ? '· ' : ''}{body}</span>;
    })}</>
  );
}

export function HelpTip({ tab, label }: { tab: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<TabHelp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setOpen(false); setD(null); setErr(null); setMsg(null); }, [tab]);   // 탭을 옮기면 닫음

  function load() {
    setErr(null);
    api<TabHelp>(`/admin/help/tab?key=${encodeURIComponent(tab)}&label=${encodeURIComponent(label)}`)
      .then((r) => { setD(r); setPick(r.linked ? `${r.linked.docCode}|${r.linked.heading}` : ''); })
      .catch((e) => setErr(e instanceof ApiFailure ? e.body.message : '도움말을 불러오지 못했습니다.'));
  }
  function toggle() { const nx = !open; setOpen(nx); if (nx && !d) load(); }
  function link() {
    const [docCode, ...h] = pick.split('|');
    setMsg(null);
    api(`/admin/help/tab-links/${encodeURIComponent(tab)}`, { method: 'PUT', body: JSON.stringify({ docCode, heading: h.join('|') }) })
      .then(() => { setMsg('이었습니다.'); load(); })
      .catch((e) => setErr(e instanceof ApiFailure ? e.body.message : '잇지 못했습니다.'));
  }

  /* h1 밖(제목 글자를 바꾸지 않음 — 옛 화면 시험이 h1 글자를 봄) · 제목 줄 오른쪽에 뜨고 펼친 칸은 그 아래 겹쳐 뜸(자리를 밀지 않음) */
  return (
    <div style={{ position: 'relative', float: 'right', marginLeft: 8 }} data-help-wrap="">
      <button type="button" className="btn-sm btn-plain" aria-expanded={open} aria-label={`${label} 도움말`} title="이 화면 도움말"
              data-help-tip={tab} onClick={toggle}>?</button>
      {open && (
        <span role="region" aria-label={`${label} 도움말`} data-help-pop={d?.found ? 'found' : d ? 'none' : 'loading'}
              style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, width: 'min(480px, 86vw)', marginTop: 6, display: 'block', padding: 12,
                       fontSize: 14, fontWeight: 400, lineHeight: 1.6, textAlign: 'left', boxShadow: 'var(--sgb-shadow-up)',
                       border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--paper)', color: 'var(--ink)' }}>
          {err && <span style={{ display: 'block', color: 'var(--danger)' }}>{err}</span>}
          {!d && !err && <span className="muted">불러오는 중…</span>}
          {d && d.section && (
            <>
              <b style={{ display: 'block', marginBottom: 4 }} data-help-heading="">{d.section.heading}</b>
              <Lines text={d.section.text} />
              <span className="muted" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                {d.docCode === 'ADMIN_GUIDE' ? '운영 화면 도움말' : '사용자 설명서'} {d.version}판{d.via === 'MANUAL' ? ' · 회원용 설명서에서 찾은 절' : ''}
              </span>
            </>
          )}
          {d && !d.section && <span className="muted" style={{ display: 'block' }} data-help-none="">{d.note}</span>}
          {d && d.canEdit && d.choices.length > 0 && (
            <span style={{ display: 'block', marginTop: 8 }} data-help-link="">
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="이을 절">
                <option value="">이을 절 고르기(SUPER)</option>
                {d.choices.map((c) => <option key={`${c.docCode}|${c.heading}`} value={`${c.docCode}|${c.heading}`}>{c.docCode === 'ADMIN_GUIDE' ? '운영' : '회원'} · {c.heading}</option>)}
              </select>{' '}
              <button type="button" className="btn-sm" disabled={!pick} onClick={link}>이 절로 잇기</button>
              {msg && <span className="muted"> {msg}</span>}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
