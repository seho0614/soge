'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile } from '@/lib/upload';
import { useTranslations } from 'next-intl';

/**
 * v10.31 (w2 · 시안 scBrkApp · scBrkMy 기준) — 중개사 인증의 「제출 서류」 체크 · 서류 파일(선택) · 보증(공제) 칸.
 *   PUT /me/broker/extra (D055) — 신청(POST /partner/broker)을 낸 뒤에 붙입니다. 서류 파일은 본인만 · 검수자만 엽니다(BROKER_DOC).
 *   시안의 「시연용 예시 번호」 칩은 실제 웹에 넣지 않습니다(남의 등록번호를 화면에 띄우지 않음).
 */
import { BROKER_DOCS } from './broker-docs';   // v10.31 검정 — 서버 화면도 쓰므로 'use client' 밖으로(broker-docs.ts)
export { BROKER_DOCS };

export interface BrokerExtraValue {
  guaranteeOrg?: string | null; guaranteeCertNo?: string | null; guaranteeAmount?: number | null;
  guaranteeFrom?: string | null; guaranteeUntil?: string | null; submittedDocs?: string[] | null; docFileCount?: number | null;
}

export function useBrokerExtra(init?: BrokerExtraValue | null) {
  const t = useTranslations('join.brokerExtra');
  const tc = useTranslations('join.brokerExtra.doc');   // v10.122 — 서류 이름(값은 코드)
  const [docs, setDocs] = useState<string[]>(init?.submittedDocs ?? ['REG_CERT', 'GUARANTEE']);
  const [g, setG] = useState({
    org: init?.guaranteeOrg ?? '', cert: init?.guaranteeCertNo ?? '', amount: init?.guaranteeAmount ? String(init.guaranteeAmount) : '',
    from: init?.guaranteeFrom?.slice(0, 10) ?? '', until: init?.guaranteeUntil?.slice(0, 10) ?? '',
  });
  const [files, setFiles] = useState<File[]>([]);
  async function save(onStep?: (s: string) => void) {
    const ids: string[] = [];
    for (const f of files) ids.push((await uploadFile(f, 'BROKER_DOC', onStep)).fileId);
    const amount = g.amount.replace(/[^0-9]/g, '');
    const r = await fetch('/api/v1/me/broker/extra', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submittedDocs: docs, docFileIds: ids.length ? ids : undefined,
        guaranteeOrg: g.org.trim() || undefined, guaranteeCertNo: g.cert.trim() || undefined,
        guaranteeAmount: amount ? Number(amount) : undefined, guaranteeFrom: g.from || undefined, guaranteeUntil: g.until || undefined,
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.message ?? t('saveFail'));
    setFiles([]);
  }
  const fields = (
    <>
      <div className="fld"><span>{t('docs')}</span>
        <div className="gw-brkdocs">{BROKER_DOCS.map(([k, t]) => (
          <label key={k} className="gw-brkdoc"><input type="checkbox" name="doc" value={k} checked={docs.includes(k)}
            onChange={(e) => setDocs(e.target.checked ? [...docs, k] : docs.filter((x) => x !== k))} /><span>{tc.has(k as never) ? tc(k as never) : t}</span></label>
        ))}</div>
        <label className="gw-ls" style={{ display: 'block', marginTop: 6 }}>{t('files')}
          <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 8))} /></label>
        <span className="gw-ls">{init?.docFileCount ? t('uploaded', { n: String(init.docFileCount) }) : ''}{t('privacy')}</span>
      </div>
      <div className="fld"><span>{t('guarantee')}</span>
        <div className="gw-g2">
          <input className="inp" placeholder={t('orgPh')} value={g.org} maxLength={60} onChange={(e) => setG({ ...g, org: e.target.value })} />
          <input className="inp" placeholder={t('certPh')} value={g.cert} maxLength={60} onChange={(e) => setG({ ...g, cert: e.target.value })} />
          <input className="inp" placeholder={t('amountPh')} inputMode="numeric" value={g.amount} onChange={(e) => setG({ ...g, amount: e.target.value })} />
          <span className="gw-inl"><input className="inp" type="date" value={g.from} onChange={(e) => setG({ ...g, from: e.target.value })} aria-label={t('from')} />
            ~ <input className="inp" type="date" value={g.until} onChange={(e) => setG({ ...g, until: e.target.value })} aria-label={t('until')} /></span>
        </div>
        <span className="gw-ls">{t('guaranteeNote')}</span>
      </div>
    </>
  );
  return { fields, save };
}

/** 내 인증 상태 화면 — 보증(공제) · 서류를 고쳐 올리는 칸 */
export function BrokerExtraForm({ init }: { init?: BrokerExtraValue | null }) {
  const router = useRouter();
  const t = useTranslations('join.brokerExtra');
  const x = useBrokerExtra(init);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form className="gw-brkform" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null); setBusy(t('saving'));
      try { await x.save((s) => setBusy(s)); setMsg(t('saved')); router.refresh(); }
      catch (e2) { setMsg((e2 as Error).message); } finally { setBusy(null); }
    }}>
      {x.fields}
      <div className="gw-dact"><button className="gw-bp gw-sm" type="submit" disabled={!!busy}>{busy ?? t('save')}</button></div>
      {msg && <p className="gw-ls" role="status">{msg}</p>}
    </form>
  );
}
