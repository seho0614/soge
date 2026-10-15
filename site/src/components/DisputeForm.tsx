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
import { uploadFile } from '@/lib/upload';

export function DisputeForm({ deals, reasons }: {
  deals: { id: string; label: string }[];
  reasons: { code: string; label: string }[];
}) {
  const router = useRouter();
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
        <h2 className="my-st2" style={{ marginTop: 0 }}>분쟁 접수</h2>
        <p className="my-emp" style={{ margin: 0 }}>분쟁을 접수할 수 있는 거래가 없습니다.</p>
      </div>
    );
  }

  async function addFile(list: FileList | null) {
    const f = list?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    if (files.length >= 3) { setErr('증빙은 3개까지 붙일 수 있습니다.'); return; }
    setUpBusy(true); setErr(null);
    try { const u = await uploadFile(f, 'INQUIRY_ATTACHMENT'); setFiles((x) => [...x, { id: u.fileId, name: u.name || f.name }]); }
    catch (e) { setErr(e instanceof Error ? e.message : '올리지 못했습니다.'); }
    setUpBusy(false);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr(null);
    if (!pick) { setErr('유형을 골라 주십시오.'); return; }
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
      if (!r.ok) { setErr(d?.message ?? '접수하지 못했습니다.'); return; }
      setDone(String(d?.id ?? ''));
      router.refresh();
    });
  }

  if (done !== null) {
    return (
      <div className="my-nt ok" role="status" data-dispute-done="">
        <b>접수했습니다{done ? ` — D-${done.slice(0, 8).toUpperCase()}` : ''}.</b> 해당 거래의 정산이 보류되었습니다. 처리되면 알림으로 알려 드립니다.
      </div>
    );
  }

  return (
    <form className="my-card" onSubmit={submit} data-dispute-form="">
      <h2 className="my-st2" style={{ marginTop: 0 }}>분쟁 접수</h2>
      <label className="my-fld">
        <span>거래</span>
        <select className="my-inp" name="dealId" required aria-label="거래">
          {deals.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <div className="my-fld">
        <span>유형</span>
        <div className="my-opts my-opts-fill" role="radiogroup" aria-label="유형">{/* v10.32 (추가) — 시안 .v31w .opt.on 진한 보라 채움(이 화면만) */}
          {reasons.map((r) => (
            <button key={r.code} type="button" role="radio" aria-checked={pick === r.code}
                    className={`my-opt${pick === r.code ? ' on' : ''}`} data-reason={r.code} onClick={() => setPick(r.code)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <label className="my-fld">
        <span>내용</span>
        <textarea className="my-inp" name="description" rows={4} required minLength={5} style={{ maxWidth: 'none' }}
                  placeholder="무엇이 약속과 달랐는지 날짜 순으로 적어 주십시오. 연락처 · 계좌번호는 적지 마십시오." />
      </label>
      {files.length > 0 && (
        <ul className="my-ls" data-evidence-list="" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
          {files.map((f) => (
            <li key={f.id}>{f.name}{' '}
              <button type="button" className="my-bo sm" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>빼기</button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="my-hbtn" style={{ marginBottom: 0 }}>
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,application/pdf"
               onChange={(e) => void addFile(e.currentTarget.files)} data-evidence-input="" />
        <button type="button" className="my-bo" disabled={upBusy || files.length >= 3} onClick={() => fileRef.current?.click()}
                title="계약서 · 대화 · 사진 — 이미지 · PDF 10MB까지 3개">
          {upBusy ? '올리는 중…' : `증빙 붙이기${files.length ? ` (${files.length}/3)` : ''}`}
        </button>
        <button className="my-bp" disabled={pending || upBusy}>{pending ? '접수 중…' : '분쟁 접수'}</button>
      </div>
    </form>
  );
}
