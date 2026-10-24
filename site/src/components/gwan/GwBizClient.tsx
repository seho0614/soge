'use client';
/**
 * v10.31 (w2) — 소개창업 축의 브라우저 쪽 동작.
 *   AxisRequestButton  공고 「업체 소개 요청」 · 자문 서비스 「자문 요청(견적 요청)」 — POST /biz/axis/{no}/requests
 *   QuickMatchForm     인력 「빠른 매칭」 — 언제까지 · 몇 분 · 어디 → POST /biz/quick (도급 · 개인 노출 없음)
 *   QuickOfferButton   빠른 매칭 줄의 「요청 보내기」(본인인증 회원 — 인력대행업체 · 개인이 회신 · v10.38 P2P) — POST /biz/quick/{id}/offer
 *   ReceivedRequests   내가 올린 항목이 받은 요청 · 회신 — GET /biz/axis-requests/{no} · POST /biz/axis-requests/{id}/answer
 * 로그인 · 본인인증이 없으면 서버가 403 을 줍니다 — 그 문구를 그대로 보여 주고 로그인으로 안내합니다.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j as { message?: string; code?: string; note?: string } };
}

export function AxisRequestButton({ no, kind, done }: { no: number; kind: 'JOB' | 'SVC'; done?: boolean }) {
  const router = useRouter();
  const t = useTranslations('gwan.biz.req');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>(done ? 'done' : 'idle');
  const [msg, setMsg] = useState('');
  const [memo, setMemo] = useState('');
  const [open, setOpen] = useState(false);
  const label = kind === 'JOB' ? t('jobLabel') : t('svcLabel');
  const sub = kind === 'JOB' ? t('jobSub') : t('svcSub');
  if (state === 'done') {
    return <button type="button" className="gw-go gw-done" disabled><span>{t('done')}</span><small>{kind === 'JOB' ? t('jobWait') : t('svcWait')}</small></button>;
  }
  async function send() {
    setState('busy'); setMsg('');
    const r = await post(`/api/v1/biz/axis/${no}/requests`, memo.trim() ? { memo: memo.trim() } : {});
    if (r.ok || r.body.code === 'ALREADY_REQUESTED') { setState('done'); setMsg(r.body.note ?? r.body.message ?? ''); router.refresh(); return; }
    setState('idle');
    setMsg(r.status === 403 && r.body.code === 'UNAUTHENTICATED' ? t('loginNeeded') : r.body.message ?? t('sendFail'));
  }
  return (
    <span className="gw-axreq">
      {open && (
        <span className="gw-axreq-f">
          <input className="gw-inp" aria-label={t('memo')} placeholder={t('memoPh')} maxLength={1000} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </span>
      )}
      <button type="button" className="gw-go" disabled={state === 'busy'} onClick={() => (open ? void send() : setOpen(true))} data-axreq={no}>
        <span>{open ? t('send') : label}</span><small>{sub}</small>
      </button>
      {msg && <span className="gw-axmsg" role="status">{msg}{msg === t('loginNeeded') && <> <Link href="/login">{t('login')}</Link></>}</span>}
    </span>
  );
}

/* v10.97 — 이름은 사전 gwan.biz.when.{코드} */
const WHEN = ['TODAY', 'TOMORROW', 'WEEK'] as const;

export function QuickMatchForm() {
  const router = useRouter();
  const t = useTranslations('gwan.biz');
  const [when, setWhen] = useState('TODAY');
  const [n, setN] = useState('');
  const [task, setTask] = useState('');
  const [place, setPlace] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    const headcount = Number(n);
    if (!headcount || headcount < 1) { setMsg(t('qm.needN')); return; }
    if (task.trim().length < 2) { setMsg(t('qm.needTask')); return; }
    if (place.trim().length < 2) { setMsg(t('qm.needPlace')); return; }
    setBusy(true); setMsg('');
    const r = await post('/api/v1/biz/quick', { when, headcount, task: task.trim(), place: place.trim() });
    setBusy(false);
    if (r.ok) { setMsg(r.body.note ?? t('qm.posted')); setN(''); setTask(''); setPlace(''); router.refresh(); return; }
    setMsg(r.status === 403 ? `${r.body.message ?? t('qm.loginNeeded')}` : r.body.message ?? t('qm.postFail'));
  }
  return (
    <div className="gw-qmf">
      <label className="gw-fld"><span>{t('qm.when')}</span>
        <div className="gw-opts">{WHEN.map((k) => <button key={k} type="button" className={`gw-opt${when === k ? ' gw-on' : ''}`} aria-pressed={when === k} onClick={() => setWhen(k)}>{t(`when.${k}`)}</button>)}</div></label>
      <label className="gw-fld"><span>{t('qm.howMany')}</span>
        <span className="gw-inl"><input className="gw-inp" type="number" placeholder={t('qm.nPh')} min={1} max={500} value={n} onChange={(e) => setN(e.target.value)} /><span className="gw-suf">{t('qm.unit')}</span></span></label>
      <label className="gw-fld"><span>{t('qm.what')}</span>
        <input className="gw-inp" type="text" placeholder={t('qm.taskPh')} maxLength={40} value={task} onChange={(e) => setTask(e.target.value)} /></label>
      <label className="gw-fld"><span>{t('qm.where')}</span>
        <input className="gw-inp" type="text" placeholder={t('qm.placePh')} maxLength={60} value={place} onChange={(e) => setPlace(e.target.value)} /></label>
      <div className="gw-hbtn2"><button type="button" className="gw-bp" disabled={busy} onClick={() => void go()}>{t('qm.find')}</button>
        {msg && <span className="gw-axmsg" role="status">{msg}</span>}</div>
    </div>
  );
}

export function QuickOfferButton({ id, offered, mine }: { id: string; offered: boolean; mine: boolean }) {
  const router = useRouter();
  const t = useTranslations('gwan.biz.offer');
  const [done, setDone] = useState(offered);
  const [msg, setMsg] = useState('');
  if (mine) {
    return <button type="button" className="gw-bo gw-sm" onClick={async () => { const r = await post(`/api/v1/biz/quick/${id}/close`, {}); if (r.ok) router.refresh(); else setMsg(r.body.message ?? ''); }}>{t('close')}</button>;
  }
  if (done) return <span className="gw-ls">{t('replied')}</span>;
  return (
    <>
      <button type="button" className="gw-bo gw-sm" title={t('title')}
        onClick={async () => { const r = await post(`/api/v1/biz/quick/${id}/offer`, {}); if (r.ok) { setDone(true); router.refresh(); } else setMsg(r.body.message ?? t('sendFail')); }}>{t('send')}</button>
      {msg && <span className="gw-axmsg" role="status">{msg}</span>}
    </>
  );
}

interface Rq { id: string; kind: string; memo: string | null; status: string; answer: string | null; createdAt: string; requester: string }

export function ReceivedRequests({ no }: { no: number }) {
  const t = useTranslations('gwan.biz.rcv');
  const [rows, setRows] = useState<Rq[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  async function load() {
    const r = await fetch(`/api/v1/biz/axis-requests/${no}`);
    setRows(r.ok ? await r.json() : []);
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [no]);
  if (!rows) return <p className="gw-ls">{t('loading')}</p>;
  if (!rows.length) return <p className="gw-ls">{t('none')}</p>;
  return (
    <div className="gw-axrows">
      {rows.map((r) => (
        <div key={r.id} className="gw-axrow">
          <div className="gw-axl"><span className={`gw-axb${r.status === 'ANSWERED' ? ' gw-axok' : ''}`}>{r.status === 'ANSWERED' ? t('replied') : t('got')}</span>
            <b>{r.requester}</b><span className="gw-ls">{r.memo ?? t('noMemo')}{r.answer ? t('answer', { answer: r.answer }) : ''}</span></div>
          {r.status !== 'ANSWERED' && (
            <div className="gw-axr">
              <input className="gw-inp" aria-label={t('replyAria')} placeholder={t('replyPh')} value={draft[r.id] ?? ''} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} />
              <button type="button" className="gw-bo gw-sm" onClick={async () => { const v = (draft[r.id] ?? '').trim(); if (v.length < 2) return; const x = await post(`/api/v1/biz/axis-requests/${r.id}/answer`, { answer: v }); if (x.ok) void load(); }}>{t('reply')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
