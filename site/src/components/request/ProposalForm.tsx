'use client';
/**
 * v10.31 — 시안 scReqDetail 「소개 제안하기」 폼: 소개할 업체 * · 업체와의 관계 * · 제안 내용 *(0 / 1000) · 제안 보내기.
 *   POST /api/v1/requests/{id}/proposals {companyName, relation, message} — 요청 1건당 1회. 연락처는 서버가 가립니다.
 *   보낸 뒤에는 「제안을 보냈습니다 — 요청자가 수락하면 대화가 열립니다」(시안 토스트 문구) + 내 제안이 목록에 보입니다(새로 고침).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const RELATIONS: Array<[string, string]> = [
  ['CLIENT', '거래처'], ['PARTNER', '협력사'], ['ACQUAINTANCE', '지인 업체'], ['OWN', '우리 회사'], ['OTHER', '기타'],
];

export function ProposalForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [company, setCompany] = useState('');
  const [relation, setRelation] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const ready = company.trim().length >= 1 && !!relation && msg.trim().length >= 10;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!company.trim()) { setErr('소개할 업체를 입력해 주세요.'); return; }
    if (!relation) { setErr('업체와의 관계를 골라 주세요.'); return; }
    if (msg.trim().length < 10) { setErr('제안 내용을 10자 이상 적어 주세요 — 조건이 왜 맞는지 구체적으로.'); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/requests/${requestId}/proposals`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: company.trim(), relation, message: msg.trim() }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(r.status === 401 ? '로그인한 뒤 제안할 수 있습니다.'
          : r.status === 403 ? (b.message ?? '사업자 회원(본인인증 완료)만 제안할 수 있습니다.')
          : (b.message ?? '제안을 보내지 못했습니다.'));
        return;
      }
      setDone(true);
      router.refresh();
    } catch { setErr('연결이 끊겼습니다. 잠시 후 다시 시도해 주십시오.'); }
    finally { setBusy(false); }
  }

  if (done) return <p className="w1-ok" role="status">제안을 보냈습니다 — 요청자가 수락하면 대화가 열립니다.</p>;

  return (
    <form onSubmit={send} noValidate>
      <div className="w1-g2">
        <div className="w1-fld">
          <label htmlFor="pp-co">소개할 업체 <i>*</i></label>
          <input id="pp-co" className="w1-in" value={company} maxLength={60} onChange={(e) => setCompany(e.target.value)} placeholder="업체명을 입력해주세요" />
        </div>
        <div className="w1-fld">
          <label htmlFor="pp-rel">업체와의 관계 <i>*</i></label>
          <select id="pp-rel" className="w1-in" value={relation} onChange={(e) => setRelation(e.target.value)}>
            <option value="">선택하세요</option>
            {RELATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <div className="w1-fh">거래처 · 협력사 · 지인 업체 등. 관계를 밝히면 수락률이 올라갑니다.</div>
        </div>
      </div>
      <div className="w1-fld">
        <label htmlFor="pp-msg">제안 내용 <i>*</i></label>
        <textarea id="pp-msg" className="w1-in" value={msg} maxLength={1000} rows={4} onChange={(e) => setMsg(e.target.value)}
          placeholder="조건이 왜 맞는지 구체적으로 적어주세요. “연결해드릴 수 있습니다”만으로는 수락되지 않습니다." />
        <div className="w1-cnt">{msg.length} / 1000</div>
      </div>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)', minWidth: 200 }}>제안은 요청자에게만 보입니다. 다른 소개자는 볼 수 없습니다.</span>
        {/* v10.32 — 시안 주황 「제안 보내기」 + 「받은 제안 보기 (요청자 화면)」(받은 제안 칸으로) */}
        <button className="w1-bdone or" disabled={busy || !ready}>{busy ? '보내는 중…' : '제안 보내기'}</button>
        <a className="w1-bo" href="#proposals">받은 제안 보기 (요청자 화면)</a>
      </div>
      {err && <p className="w1-err" role="alert">{err}</p>}
    </form>
  );
}
