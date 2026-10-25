'use client';
/**
 * SB-HOM-ETC-010 「분쟁 접수」 카드 — v10.32 시안(scDspU) 모양.
 *   거래(고르기) · 유형 칩(서버 dispute.reason) · 내용 · [증빙 붙이기] [분쟁 접수]
 *   보내는 값은 그대로(dealId · reasonCode · description) + 증빙 파일 id(evidenceKeys · 3개까지).
 * 증빙은 고르는 즉시 올리고(INQUIRY_ATTACHMENT · 이미지 · PDF 10MB), 접수 때 붙입니다 — 올린 사람과 운영만 봅니다.
 * 접수하면 시안처럼 초록 안내로 바뀌고, 아래 「처리 현황」 표가 새로 읽힙니다.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { uploadFile } from '@/lib/upload';

export function DisputeForm({ deals, reasons }: {
  deals: { id: string; label: string }[];
  reasons: { code: string; label: string }[];
}) {
  const router = useRouter();
  const t = useTranslations('deal.dispute');
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState(reasons[0]?.code ?? '');
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [upBusy, setUpBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (deals.length === 0) {
    return (
      <div className="my-card" data-dispute-form="">
        <h2 className="my-st2" style={{ marginTop: 0 }}>{t('title')}</h2>
        <p className="my-emp" style={{ margin: 0 }}>{t('noDeals')}</p>
      </div>
    );
  }

  async function addFile(list: FileList | null) {
    const f = list?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    if (files.length >= 3) { setErr(t('max')); return; }
    setUpBusy(true); setErr(null);
    try { const u = await uploadFile(f, 'INQUIRY_ATTACHMENT'); setFiles((x) => [...x, { id: u.fileId, name: u.name || f.name }]); }
    catch (e) { setErr(e instanceof Error ? e.message : t('uploadFail')); }
    setUpBusy(false);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr(null);
    if (!pick) { setErr(t('pickType')); return; }
    start(async () => {
      const r = await fetch('/api/v1/disputes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: String(fd.get('dealId')),
          reasonCode: pick,
          description: String(fd.get('description')),
          ...(files.length ? { evidenceKeys: files.map((f) => f.id) } : {}),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      setDone(String(d?.id ?? ''));
      router.refresh();
    });
  }

  if (done !== null) {
    return (
      <div className="my-nt ok" role="status" data-dispute-done="">
        {t.rich('done', { no: done ? ` — D-${done.slice(0, 8).toUpperCase()}` : '', b: (x) => <b>{x}</b> })}
      </div>
    );
  }

  return (
    <form className="my-card" onSubmit={submit} data-dispute-form="">
      <h2 className="my-st2" style={{ marginTop: 0 }}>{t('title')}</h2>
      <label className="my-fld">
        <span>{t('deal')}</span>
        <select className="my-inp" name="dealId" required aria-label={t('deal')}>
          {deals.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <div className="my-fld">
        <span>{t('type')}</span>
        <div className="my-opts my-opts-fill" role="radiogroup" aria-label={t('type')}>{/* v10.32 (추가) — 시안 .v31w .opt.on 진한 보라 채움(이 화면만) */}
          {reasons.map((r) => (
            <button key={r.code} type="button" role="radio" aria-checked={pick === r.code}
                    className={`my-opt${pick === r.code ? ' on' : ''}`} data-reason={r.code} onClick={() => setPick(r.code)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <label className="my-fld">
        <span>{t('body')}</span>
        <textarea className="my-inp" name="description" rows={4} required minLength={5} style={{ maxWidth: 'none' }}
                  placeholder={t('bodyPh')} />
      </label>
      {files.length > 0 && (
        <ul className="my-ls" data-evidence-list="" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
          {files.map((f) => (
            <li key={f.id}>{f.name}{' '}
              <button type="button" className="my-bo sm" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>{t('remove')}</button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="my-hbtn" style={{ marginBottom: 0 }}>
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,application/pdf"
               onChange={(e) => void addFile(e.currentTarget.files)} data-evidence-input="" />
        <button type="button" className="my-bo" disabled={upBusy || files.length >= 3} onClick={() => fileRef.current?.click()}
                title={t('attachTitle')}>
          {upBusy ? t('uploading') : t('attach', { count: files.length ? ` (${files.length}/3)` : '' })}
        </button>
        <button className="my-bp" disabled={pending || upBusy}>{pending ? t('submitting') : t('title')}</button>
      </div>
    </form>
  );
}
