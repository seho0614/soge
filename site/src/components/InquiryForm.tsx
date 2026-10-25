'use client';
/**
 * SB-HOM-ETC-030 문의하기 — v10.31 시안 scCs 의 폼: 문의 유형 칩 5종 · (신고 · 분쟁이면) 분쟁 경로 안내 · (거래 · 정산이면) 관련 거래 ·
 *   제목(60자) · 내용 · 답변받을 이메일(로그인이면 가입 이메일 — 읽기 전용) · 문의 접수하기 → 접수 완료 화면(접수번호 · 답변 예정).
 *   계좌번호 · 주민등록번호는 적지 않게 안내합니다(시안 문구).
 */
import { upload } from '@/components/form/RegParts';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/* v10.101 (2-5b) — 유형 이름은 사전 forms.inq.type.* */
const TYPES = ['DEAL', 'SETTLE', 'ACCOUNT', 'DISPUTE', 'ETC'] as const;
export interface MyDeal { id: string; title: string | null; statusLabel?: string | null }

/* v10.31 — ?type=DISPUTE · ?deal= 로 들어오면(1:1 문의 화면의 「신고」) 그 유형 · 거래를 고른 채로 엽니다 */
export function InquiryForm({ email, deals, loggedIn, initialType, initialDeal }: { email: string | null; deals: MyDeal[]; loggedIn: boolean; initialType?: string; initialDeal?: string }) {
  const router = useRouter();
  const ft = useTranslations('forms');
  const t = useTranslations('forms.inq');
  const [pending, start] = useTransition();
  const [type, setType] = useState<string>(TYPES.some((v) => v === initialType) ? initialType! : 'DEAL');
  const [dealId, setDealId] = useState(initialDeal && deals.some((d) => d.id === initialDeal) ? initialDeal : '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mail, setMail] = useState(email ?? '');
  const [err, setErr] = useState<string | null>(null);
  /* 시안 「첨부파일 — 이미지 · PDF 10MB까지 (최대 3개)」 — 고르면 바로 올리고(INQUIRY_ATTACHMENT) 접수 때 파일 id 를 붙입니다(로그인한 경우만) */
  const [files, setFiles] = useState<Array<{ id: string; name: string }>>([]);
  const [upBusy, setUpBusy] = useState(false);
  async function addFile(list: FileList | null) {
    const f = list?.[0]; if (!f) return;
    if (files.length >= 3) { setErr(t('max3')); return; }
    setUpBusy(true); setErr(null);
    try { const id = await upload(f, 'INQUIRY_ATTACHMENT', true, ft); setFiles((x) => [...x, { id, name: f.name }]); }
    catch (e) { setErr(e instanceof Error ? e.message : ft('img.fail')); }
    setUpBusy(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (type === 'DISPUTE') { setErr(t('errDispute')); return; }
    if (title.trim().length < 2) { setErr(t('errTitle')); return; }
    if (body.trim().length < 5) { setErr(t('errBody')); return; }
    if (!loggedIn && !/.+@.+\..+/.test(mail)) { setErr(t('errMail')); return; }
    start(async () => {
      const r = await fetch('/api/v1/inquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: type, title: title.trim(), body: body.trim(),
          email: loggedIn ? undefined : mail.trim(), dealId: (type === 'DEAL' || type === 'SETTLE') && dealId ? dealId : undefined,
          ...(files.length ? { attachmentKeys: files.map((f) => f.id) } : {}),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('errFail')); return; }
      const q = new URLSearchParams({ no: d.no ?? '', cat: d.categoryLabel ?? '', due: d.dueAt ?? '', st: d.status ?? 'OPEN' });
      router.push(`/support/done?${q}`);
    });
  }

  return (
    <form className="w1-jp" onSubmit={submit} noValidate id="inquiry">
      <div className="w1-jt">{t('title')}</div>
      <div className="w1-fld"><span className="lb">{t('typeLabel')} <i>*</i></span>
        <div className="w1-cst" role="radiogroup" aria-label={t('typeLabel')}>
          {TYPES.map((v) => <button key={v} type="button" role="radio" aria-checked={type === v} className={`w1-ct${type === v ? ' on' : ''}`} onClick={() => setType(v)}>{t(`type.${v}`)}</button>)}
        </div>
      </div>
      {type === 'DISPUTE' && (
        <div className="w1-nt warn" style={{ marginBottom: 14 }}><b>{t('dispTitle')}</b><br />
          {t.rich('dispBody', { b: (c) => <b>{c}</b> })}
          <div style={{ marginTop: 9 }}><Link className="w1-bo sm" href="/support/dispute">{t('dispGo')}</Link>{' '}<Link className="w1-bo sm" href="/report">{t('report')}</Link></div></div>
      )}
      {(type === 'DEAL' || type === 'SETTLE') && (
        <div className="w1-fld"><label htmlFor="cs-deal">{t('deal')}</label>
          <select id="cs-deal" className="w1-in" value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={!loggedIn}>
            <option value="">{t('dealNone')}</option>
            {deals.map((d) => <option key={d.id} value={d.id}>#{d.id.slice(0, 4).toUpperCase()} · {d.title ?? t('dealFallback')}{d.statusLabel ? ` (${d.statusLabel})` : ''}</option>)}
          </select>
          <div className="w1-fh">{loggedIn ? t('dealHint') : t('dealHintGuest')}</div></div>
      )}
      <div className="w1-fld"><label htmlFor="cs-title">{t('subject')} <i>*</i></label>
        <input id="cs-title" className="w1-in" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('subjectPh')} /></div>
      <div className="w1-fld"><label htmlFor="cs-body">{t('body')} <i>*</i></label>
        <textarea id="cs-body" className="w1-in" rows={6} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('bodyPh')} />
        <div className="w1-fh">{t('bodyHint')}</div></div>
      {/* v10.32 — 시안처럼 첨부파일 · 답변받을 이메일을 한 줄 두 칸으로 */}
      <div className="w1-g2">
      <div className="w1-fld"><span className="lb">{t('attach')}</span>
        {loggedIn ? (
          <>
            <label className={`w1-upl${upBusy || files.length >= 3 ? ' off' : ''}`}>
              <input type="file" accept="image/jpeg,image/png,application/pdf" hidden disabled={upBusy || files.length >= 3}
                onChange={(e) => { void addFile(e.target.files); e.target.value = ''; }} data-inq-file="" />
              📎 {upBusy ? ft('img.uploading') : t('attachPick')}
            </label>
            {files.length > 0 && (
              <ul className="w1-upls">{files.map((f) => (
                <li key={f.id}>{f.name} <button type="button" className="w1-bo sm" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>{t('remove')}</button></li>
              ))}</ul>
            )}
          </>
        ) : <><span className="w1-upl off" aria-disabled="true">📎 {t('attachPick')}</span>
          <div className="w1-fh">{t('attachGuest')}</div></>}
      </div>
      <div className="w1-fld"><label htmlFor="cs-mail">{t('mail')} <i>*</i></label>
        <input id="cs-mail" className="w1-in" type="email" value={mail} readOnly={loggedIn} onChange={(e) => setMail(e.target.value)} placeholder="name@company.com" />
        <div className="w1-fh">{loggedIn ? t('mailHint') : t('mailHintGuest')}</div></div>
      </div>
      {err && <p className="w1-err" role="alert">{err}</p>}
      <div className="w1-jsub"><button className="w1-bor" disabled={pending}>{pending ? t('submitting') : t('submit')}</button></div>
    </form>
  );
}
