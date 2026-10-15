'use client';

import { useState } from 'react';

interface Cand { code: string; name: string; gwan: string; score?: number }
interface Res {
  blocked: boolean; classified: boolean;
  candidates?: Cand[];
  reason?: string; matched?: string;
}

const GWAN: Record<string, string> = {
  MNY: '소개장터', MAL: '안심소개', BIZ: '소개창업', HLT: '소개몰',
};

/**
 * 분류 시험.
 *
 * ★ 결과를 그대로 적용하지 않습니다. 후보를 보여 주고 사람이
 *   고릅니다 — 자동으로 정하면 틀렸을 때 이유를 알 수 없습니다.
 */
export function ClassifyPanel() {
  const [text, setText] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!text.trim()) return;
    setBusy(true); setRes(null);
    try {
      const r = await fetch('/api/v1/ai/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      setRes(r.ok ? await r.json() : null);
    } catch {
      setRes(null);
    }
    setBusy(false);
  }

  return (
    <div>
      <textarea
        className="inp"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="예) 강남 상가 매물을 소개합니다. 1층 20평, 권리금 있습니다."
        aria-label="분류할 내용"
      />
      <button type="button" className="btn-primary" disabled={busy || !text.trim()}
        onClick={() => void run()}>
        {busy ? '보는 중…' : '업종 찾기'}
      </button>

      {res?.blocked ? (
        <div className="note warn">
          <b>등록할 수 없는 표현이 있습니다.</b>
          {res.matched ? <> 「{res.matched}」 — {res.reason}</> : null}
        </div>
      ) : null}

      {res && !res.blocked && res.candidates?.length ? (
        <>
          <h2>후보</h2>
          <table className="tbl">
            <thead><tr><th>업종</th><th>관</th></tr></thead>
            <tbody>
              {res.candidates.map((c) => (
                <tr key={c.code}>
                  <td><strong>{c.name}</strong></td>
                  <td>{GWAN[c.gwan] ?? c.gwan}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            <b>맞는 것을 직접 고르십시오.</b> 후보가 없으면 글을 조금 더
            구체적으로 적어 주시면 찾기 쉬워집니다.
          </p>
        </>
      ) : null}

      {res && !res.blocked && !res.candidates?.length ? (
        <div className="empty">
          맞는 업종을 찾지 못했습니다. 무엇을 소개하시는지 조금 더
          구체적으로 적어 주십시오.
        </div>
      ) : null}
    </div>
  );
}
