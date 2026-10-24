'use client';
/**
 * v10.31 — 시안 scReqDetail 「소개 제안하기」 폼: 소개할 업체 * · 업체와의 관계 * · 제안 내용 *(0 / 1000) · 제안 보내기.
 *   POST /api/v1/requests/{id}/proposals {companyName, relation, message} — 요청 1건당 1회. 연락처는 서버가 가립니다.
 *   보낸 뒤에는 「제안을 보냈습니다 — 요청자가 수락하면 대화가 열립니다」(시안 토스트 문구) + 내 제안이 목록에 보입니다(새로 고침).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const RELATIONS = ['CLIENT', 'PARTNER', 'ACQUAINTANCE', 'OWN', 'OTHER'] as const;

export function ProposalForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const t = useTranslations('request.form');
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
    if (!company.trim()) { setErr(t('errCompany')); return; }
    if (!relation) { setErr(t('errRelation')); return; }
    if (msg.trim().length < 10) { setErr(t('errMsg')); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/requests/${requestId}/proposals`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: company.trim(), relation, message: msg.trim() }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(r.status === 401 ? t('err401')
          : r.status === 403 ? (b.message ?? t('err403'))
          : (b.message ?? t('errSend')));
        return;
      }
      setDone(true);
      router.refresh();
    } catch { setErr(t('errNetwork')); }
    finally { setBusy(false); }
  }

  if (done) return <p className="w1-ok" role="status">{t('done')}</p>;

  return (
    <form onSubmit={send} noValidate>
      <div className="w1-g2">
        <div className="w1-fld">
          <label htmlFor="pp-co">{t('company')} <i>*</i></label>
          <input id="pp-co" className="w1-in" value={company} maxLength={60} onChange={(e) => setCompany(e.target.value)} placeholder={t('companyPh')} />
        </div>
        <div className="w1-fld">
          <label htmlFor="pp-rel">{t('relationLabel')} <i>*</i></label>
          <select id="pp-rel" className="w1-in" value={relation} onChange={(e) => setRelation(e.target.value)}>
            <option value="">{t('relationPick')}</option>
            {RELATIONS.map((v) => <option key={v} value={v}>{t(`relation.${v}`)}</option>)}
          </select>
          <div className="w1-fh">{t('relationHelp')}</div>
        </div>
      </div>
      <div className="w1-fld">
        <label htmlFor="pp-msg">{t('msg')} <i>*</i></label>
        <textarea id="pp-msg" className="w1-in" value={msg} maxLength={1000} rows={4} onChange={(e) => setMsg(e.target.value)}
          placeholder={t('msgPh')} />
        <div className="w1-cnt">{msg.length} / 1000</div>
      </div>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)', minWidth: 200 }}>{t('privacy')}</span>
        {/* v10.32 — 시안 주황 「제안 보내기」 + 「받은 제안 보기 (요청자 화면)」(받은 제안 칸으로) */}
        <button className="w1-bdone or" disabled={busy || !ready}>{busy ? t('sending') : t('send')}</button>
        <a className="w1-bo" href="#proposals">{t('viewProposals')}</a>
      </div>
      {err && <p className="w1-err" role="alert">{err}</p>}
    </form>
  );
}
