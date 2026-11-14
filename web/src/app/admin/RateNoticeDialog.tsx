import { useState } from 'react';
import { createRoot } from 'react-dom/client';

/** 고른 것 — null 은 「나중에」(초안 그대로) · 'NOW' 는 바로 게시 · 날짜(YYYY-MM-DD)는 그날 0시(한국) 게시 예약 */
export type NoticeTiming = null | 'NOW' | string;

const kst = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const minus = (ymd: string, days: number) => kst(new Date(new Date(`${ymd}T00:00:00+09:00`).getTime() - days * 86400 * 1000));

/**
 * v10.291 (docs/414) — 요율 인상 예약 뒤 · 「공지 게시」 때 공지 시점 고르기 확인 창
 *   「지금 공지」 · 「날짜 정해 공지」(오늘 ~ 시행일 31일 전) · 「나중에」(초안 그대로 · 「요율 변경 예정」에서 게시)
 *   서버가 같은 범위를 다시 검사합니다(POST /admin/health/rate-schedules/{id}/notice · at).
 */
function Dialog({ effectiveDate, title, later, done }: { effectiveDate: string; title: string; later: boolean; done: (v: NoticeTiming) => void }) {
  const today = kst(new Date());
  const last = minus(effectiveDate, 31);
  const [mode, setMode] = useState<'NOW' | 'DATE'>('NOW');
  const [at, setAt] = useState(last >= today ? last : today);
  const late = last < today;
  const bad = mode === 'DATE' && (!/^\d{4}-\d{2}-\d{2}$/.test(at) || at < today || at > last);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      role="dialog" aria-modal="true" aria-label="요율 변경 공지" data-rate-notice-dialog={effectiveDate}>
      <div className="card pad" style={{ maxWidth: 460, width: '100%' }}>
        <b>요율 변경 공지 — 언제 게시할까요?</b>
        <p className="dim" style={{ margin: '6px 0' }}>「{title}」 · 시행일 {effectiveDate} · 입점 약관 제17조 4항 — 게시한 날 + 31일 ≤ 시행일</p>
        {late ? (
          <p className="warn-text" data-rate-notice-dialog-late>시행일까지 30일이 남지 않아 공지할 수 없습니다(마지막 날 {last}) — 예약을 취소하고 시행일을 다시 정하십시오.</p>
        ) : (
          <>
            <label style={{ display: 'block', margin: '6px 0' }}>
              <input type="radio" name="rn-mode" checked={mode === 'NOW'} onChange={() => setMode('NOW')} data-rate-notice-now /> 지금 공지(맨 위 고정 · 파트너센터 · 판매자센터)
            </label>
            <label style={{ display: 'block', margin: '6px 0' }}>
              <input type="radio" name="rn-mode" checked={mode === 'DATE'} onChange={() => setMode('DATE')} data-rate-notice-date-mode /> 날짜 정해 공지(그날 0시 · {today} ~ {last})
            </label>
            {mode === 'DATE' && (
              <input type="date" min={today} max={last} value={at} onChange={(e) => setAt(e.target.value)} aria-label="공지 날짜" data-rate-notice-at />
            )}
            {bad && <p className="warn-text">공지 날짜는 {today} ~ {last} 사이로 정해 주십시오.</p>}
          </>
        )}
        <div className="acts" style={{ marginTop: 10 }}>
          {!late && <button className="btn-ok btn-sm" disabled={bad} onClick={() => done(mode === 'NOW' ? 'NOW' : at)} data-rate-notice-go>{mode === 'NOW' ? '지금 공지' : '이 날짜로 공지'}</button>}
          <button className="btn-sm" onClick={() => done(null)} data-rate-notice-later>{later ? '나중에(초안 그대로)' : '그만'}</button>
        </div>
        {later && <p className="hint" style={{ marginTop: 6 }}>나중에 고르면 공지는 초안으로 남고, 「요율 변경 예정」 줄의 「공지 게시」로 게시합니다. 하루가 지나도 게시하지 않으면 운영 알림이 뜹니다.</p>}
      </div>
    </div>
  );
}

/** 확인 창을 띄우고 고른 것을 돌려줌(창은 닫힘) */
export function askNoticeTiming(effectiveDate: string, title: string, later = true): Promise<NoticeTiming> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: NoticeTiming) => { root.unmount(); host.remove(); resolve(v); };
    root.render(<Dialog effectiveDate={effectiveDate} title={title} later={later} done={done} />);
  });
}
