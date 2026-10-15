'use client';
/** v10.31 (w2) — 피해 사례 작성 칸(POST /safety/cases). 유형 · 지역 · 제목 · 내용. 서버가 연락처 · 이메일 · 계좌번호를 가려 저장합니다. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const TYPES: [string, string][] = [['CONTRACT', '계약사기'], ['PAYMENT', '대금사기'], ['GOODS', '물품/서비스 사기'], ['PRIVACY', '개인정보/보이스피싱'], ['ETC', '기타 사기']];

export function SafetyCaseForm({ regions }: { regions: { code: string; name: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState('CONTRACT');
  const [region, setRegion] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    if (title.trim().length < 5) { setMsg('제목을 5자 이상 적어 주십시오.'); return; }
    if (body.trim().length < 20) { setMsg('내용을 20자 이상 적어 주십시오.'); return; }
    setBusy(true); setMsg('');
    const r = await fetch('/api/v1/safety/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title: title.trim(), body: body.trim(), ...(region ? { regionCode: region } : {}) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { router.push(`/safety/cases/${j.no}`); return; }
    setMsg(j.message ?? '올리지 못했습니다.');
  }
  return (
    <div className="gw-cslf" data-safety-form="">
      <label className="gw-fld"><span>피해 유형</span>
        <div className="gw-opts">{TYPES.map(([k, t]) => <button key={k} type="button" className={`gw-opt${type === k ? ' gw-on' : ''}`} aria-pressed={type === k} onClick={() => setType(k)}>{t}</button>)}</div></label>
      <label className="gw-fld"><span>지역 (선택)</span>
        <select className="gw-inp" value={region} onChange={(e) => setRegion(e.target.value)}><option value="">선택 안 함</option>{regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
      <label className="gw-fld"><span>제목</span>
        <input className="gw-inp" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 선입금 후 연락 두절된 대금 사기" /></label>
      <label className="gw-fld"><span>내용</span>
        <textarea className="gw-inp" rows={8} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="언제 · 어떤 방식으로 · 어떻게 알게 됐는지 적어 주십시오. 상대 실명 · 연락처 · 계좌번호는 쓰지 마십시오(가려서 저장됩니다)." /></label>
      <div className="gw-axwarn">작성자는 공개되지 않습니다. 특정인을 지목하거나 사실과 다른 글은 운영이 숨길 수 있습니다. 하루 3건까지 쓸 수 있습니다.</div>
      <div className="gw-abar" style={{ borderTop: 0, padding: '6px 0 0' }}><span className="gw-sp" />
        {msg && <span className="gw-axmsg" role="status">{msg}</span>}
        <button type="button" className="gw-go" disabled={busy} onClick={() => void go()}><span>피해 사례 올리기</span><small>본인인증 회원 · 하루 3건</small></button></div>
    </div>
  );
}
