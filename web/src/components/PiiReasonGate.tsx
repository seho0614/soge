import { useState, type ReactNode } from 'react';

/**
 * 개인정보 열람 사유 (v10.359 · D236 · docs/493)
 *
 * 개인정보가 보이는 운영 화면(사업자 인증 · 거래 · 회원 상세)을 열기 전에 사유를 고릅니다(4시간 유지 · 이 브라우저 탭).
 * 고른 사유는 모든 API 요청 머리글 X-PII-Reason 으로 가고(lib/api.ts), 서버가 개인정보 접속기록에 「… · 사유 …」로 남깁니다.
 */
export const PII_REASONS: Array<[string, string]> = [
  ['INQUIRY', '문의 답변'], ['DISPUTE', '분쟁 처리'], ['SETTLEMENT', '정산 · 지급'], ['REVIEW', '심사 · 인증'], ['LEGAL', '법적 요청'], ['OTHER', '기타(직접 적기)'],
];
const KEY = 'sgb_pii_reason';
const HOURS = 4;

export function piiReasonHeader(): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null') as { code: string; text?: string; until: number } | null;
    if (!v || v.until < Date.now()) return null;
    return v.code === 'OTHER' ? `OTHER:${encodeURIComponent((v.text ?? '').slice(0, 60))}` : v.code;
  } catch { return null; }
}

export function PiiReasonGate({ what, children }: { what: string; children: ReactNode }) {
  const [ok, setOk] = useState(() => piiReasonHeader() != null);
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  if (ok) return <>{children}</>;
  const save = () => {
    try { sessionStorage.setItem(KEY, JSON.stringify({ code, text: code === 'OTHER' ? text.trim() : undefined, until: Date.now() + HOURS * 3600_000 })); } catch { /* 저장소가 막힌 브라우저 — 이번 화면만 */ }
    setOk(true);
  };
  return (
    <div className="card" data-pii-gate={what}>
      <h3 className="sec">개인정보 열람 사유</h3>
      <p className="muted">{what} 화면에는 회원 · 사업자의 개인정보가 보입니다. 사유를 고르면 {HOURS}시간 동안 다시 묻지 않으며, 개인정보 접속기록에 사유가 남습니다(위험감지 › 개인정보 접속기록).</p>
      <p>
        {PII_REASONS.map(([c, l]) => (
          <label key={c} style={{ marginRight: 12 }}><input type="radio" name="pii-reason" value={c} checked={code === c} onChange={() => setCode(c)} data-pii-reason={c} /> {l}</label>
        ))}
      </p>
      {code === 'OTHER' && <p><input name="pii-reason-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={60} placeholder="사유(2 ~ 60자)" style={{ width: 320 }} /></p>}
      <p><button className="btn-ok" disabled={!code || (code === 'OTHER' && text.trim().length < 2)} onClick={save} data-pii-reason-ok="">이 사유로 열기</button></p>
    </div>
  );
}
