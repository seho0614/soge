'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFile } from '@/lib/upload';

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
    if (!r.ok) throw new Error(j?.message ?? '서류 · 보증 정보를 저장하지 못했습니다.');
    setFiles([]);
  }
  const fields = (
    <>
      <div className="fld"><span>제출 서류</span>
        <div className="gw-brkdocs">{BROKER_DOCS.map(([k, t]) => (
          <label key={k} className="gw-brkdoc"><input type="checkbox" name="doc" value={k} checked={docs.includes(k)}
            onChange={(e) => setDocs(e.target.checked ? [...docs, k] : docs.filter((x) => x !== k))} /><span>{t}</span></label>
        ))}</div>
        <label className="gw-ls" style={{ display: 'block', marginTop: 6 }}>서류 파일 (선택 · PDF · 사진, 최대 8개)
          <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 8))} /></label>
        <span className="gw-ls">{init?.docFileCount ? `이미 올린 서류 ${init.docFileCount}개 · ` : ''}올린 파일은 본인과 검수자만 엽니다.</span>
      </div>
      <div className="fld"><span>보증(공제)</span>
        <div className="gw-g2">
          <input className="inp" placeholder="기관 (예: 공인중개사협회)" value={g.org} maxLength={60} onChange={(e) => setG({ ...g, org: e.target.value })} />
          <input className="inp" placeholder="증서 번호" value={g.cert} maxLength={60} onChange={(e) => setG({ ...g, cert: e.target.value })} />
          <input className="inp" placeholder="금액(원)" inputMode="numeric" value={g.amount} onChange={(e) => setG({ ...g, amount: e.target.value })} />
          <span className="gw-inl"><input className="inp" type="date" value={g.from} onChange={(e) => setG({ ...g, from: e.target.value })} aria-label="보증 시작일" />
            ~ <input className="inp" type="date" value={g.until} onChange={(e) => setG({ ...g, until: e.target.value })} aria-label="보증 만료일" /></span>
        </div>
        <span className="gw-ls">공제는 공개 API 가 없어 증서 입력과 만료일 관리로 갑니다. 보증 없이는 승인되지 않습니다(INV-BR4).</span>
      </div>
    </>
  );
  return { fields, save };
}

/** 내 인증 상태 화면 — 보증(공제) · 서류를 고쳐 올리는 칸 */
export function BrokerExtraForm({ init }: { init?: BrokerExtraValue | null }) {
  const router = useRouter();
  const x = useBrokerExtra(init);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form className="gw-brkform" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null); setBusy('저장하는 중…');
      try { await x.save((s) => setBusy(s)); setMsg('저장했습니다.'); router.refresh(); }
      catch (e2) { setMsg((e2 as Error).message); } finally { setBusy(null); }
    }}>
      {x.fields}
      <div className="gw-dact"><button className="gw-bp gw-sm" type="submit" disabled={!!busy}>{busy ?? '서류 · 보증 저장'}</button></div>
      {msg && <p className="gw-ls" role="status">{msg}</p>}
    </form>
  );
}
