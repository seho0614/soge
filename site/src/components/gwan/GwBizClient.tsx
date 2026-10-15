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

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j as { message?: string; code?: string; note?: string } };
}

export function AxisRequestButton({ no, kind, done }: { no: number; kind: 'JOB' | 'SVC'; done?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>(done ? 'done' : 'idle');
  const [msg, setMsg] = useState('');
  const [memo, setMemo] = useState('');
  const [open, setOpen] = useState(false);
  const label = kind === 'JOB' ? '업체 소개 요청' : '자문 요청';
  const sub = kind === 'JOB' ? '인력대행업체 · 헤드헌팅사를 이어 드립니다' : '견적 요청 → 매칭 → 계약';
  if (state === 'done') {
    return <button type="button" className="gw-go gw-done" disabled><span>요청 접수됨</span><small>{kind === 'JOB' ? '업체 회신을 기다리는 중입니다 — 「지원」에서 봅니다' : '회신을 기다리는 중입니다'}</small></button>;
  }
  async function send() {
    setState('busy'); setMsg('');
    const r = await post(`/api/v1/biz/axis/${no}/requests`, memo.trim() ? { memo: memo.trim() } : {});
    if (r.ok || r.body.code === 'ALREADY_REQUESTED') { setState('done'); setMsg(r.body.note ?? r.body.message ?? ''); router.refresh(); return; }
    setState('idle');
    setMsg(r.status === 403 && r.body.code === 'UNAUTHENTICATED' ? '로그인이 필요합니다.' : r.body.message ?? '요청을 보내지 못했습니다.');
  }
  return (
    <span className="gw-axreq">
      {open && (
        <span className="gw-axreq-f">
          <input className="gw-inp" aria-label="요청 내용(선택)" placeholder="요청 내용(선택) — 연락처는 적지 마십시오" maxLength={1000} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </span>
      )}
      <button type="button" className="gw-go" disabled={state === 'busy'} onClick={() => (open ? void send() : setOpen(true))} data-axreq={no}>
        <span>{open ? '요청 보내기' : label}</span><small>{sub}</small>
      </button>
      {msg && <span className="gw-axmsg" role="status">{msg}{msg === '로그인이 필요합니다.' && <> <Link href="/login">로그인</Link></>}</span>}
    </span>
  );
}

const WHEN: [string, string][] = [['TODAY', '오늘'], ['TOMORROW', '내일'], ['WEEK', '이번 주']];

export function QuickMatchForm() {
  const router = useRouter();
  const [when, setWhen] = useState('TODAY');
  const [n, setN] = useState('');
  const [task, setTask] = useState('');
  const [place, setPlace] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    const headcount = Number(n);
    if (!headcount || headcount < 1) { setMsg('몇 분이 필요한지 적어 주십시오.'); return; }
    if (task.trim().length < 2) { setMsg('어떤 일인지 적어 주십시오(예: 물류센터 피킹).'); return; }
    if (place.trim().length < 2) { setMsg('어디인지 적어 주십시오(예: 경기 김포시 운양동).'); return; }
    setBusy(true); setMsg('');
    const r = await post('/api/v1/biz/quick', { when, headcount, task: task.trim(), place: place.trim() });
    setBusy(false);
    if (r.ok) { setMsg(r.body.note ?? '요청을 올렸습니다.'); setN(''); setTask(''); setPlace(''); router.refresh(); return; }
    setMsg(r.status === 403 ? `${r.body.message ?? '로그인이 필요합니다.'}` : r.body.message ?? '올리지 못했습니다.');
  }
  return (
    <div className="gw-qmf">
      <label className="gw-fld"><span>언제까지 필요하십니까</span>
        <div className="gw-opts">{WHEN.map(([k, t]) => <button key={k} type="button" className={`gw-opt${when === k ? ' gw-on' : ''}`} aria-pressed={when === k} onClick={() => setWhen(k)}>{t}</button>)}</div></label>
      <label className="gw-fld"><span>몇 분이 필요하십니까</span>
        <span className="gw-inl"><input className="gw-inp" type="number" placeholder="예: 12" min={1} max={500} value={n} onChange={(e) => setN(e.target.value)} /><span className="gw-suf">명</span></span></label>
      <label className="gw-fld"><span>어떤 일입니까</span>
        <input className="gw-inp" type="text" placeholder="예: 물류센터 피킹" maxLength={40} value={task} onChange={(e) => setTask(e.target.value)} /></label>
      <label className="gw-fld"><span>어디입니까</span>
        <input className="gw-inp" type="text" placeholder="예: 경기 김포시 운양동" maxLength={60} value={place} onChange={(e) => setPlace(e.target.value)} /></label>
      <div className="gw-hbtn2"><button type="button" className="gw-bp" disabled={busy} onClick={() => void go()}>업체 찾기</button>
        {msg && <span className="gw-axmsg" role="status">{msg}</span>}</div>
    </div>
  );
}

export function QuickOfferButton({ id, offered, mine }: { id: string; offered: boolean; mine: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState(offered);
  const [msg, setMsg] = useState('');
  if (mine) {
    return <button type="button" className="gw-bo gw-sm" onClick={async () => { const r = await post(`/api/v1/biz/quick/${id}/close`, {}); if (r.ok) router.refresh(); else setMsg(r.body.message ?? ''); }}>내 요청 닫기</button>;
  }
  if (done) return <span className="gw-ls">회신함</span>;
  return (
    <>
      <button type="button" className="gw-bo gw-sm" title="본인인증 회원(인력대행업체 · 개인)이 이 요청에 회신합니다"
        onClick={async () => { const r = await post(`/api/v1/biz/quick/${id}/offer`, {}); if (r.ok) { setDone(true); router.refresh(); } else setMsg(r.body.message ?? '보내지 못했습니다.'); }}>요청 보내기</button>
      {msg && <span className="gw-axmsg" role="status">{msg}</span>}
    </>
  );
}

interface Rq { id: string; kind: string; memo: string | null; status: string; answer: string | null; createdAt: string; requester: string }

export function ReceivedRequests({ no }: { no: number }) {
  const [rows, setRows] = useState<Rq[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  async function load() {
    const r = await fetch(`/api/v1/biz/axis-requests/${no}`);
    setRows(r.ok ? await r.json() : []);
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [no]);
  if (!rows) return <p className="gw-ls">받은 요청을 불러오는 중…</p>;
  if (!rows.length) return <p className="gw-ls">아직 받은 요청이 없습니다.</p>;
  return (
    <div className="gw-axrows">
      {rows.map((r) => (
        <div key={r.id} className="gw-axrow">
          <div className="gw-axl"><span className={`gw-axb${r.status === 'ANSWERED' ? ' gw-axok' : ''}`}>{r.status === 'ANSWERED' ? '회신함' : '받음'}</span>
            <b>{r.requester}</b><span className="gw-ls">{r.memo ?? '(내용 없음)'}{r.answer ? ` · 회신: ${r.answer}` : ''}</span></div>
          {r.status !== 'ANSWERED' && (
            <div className="gw-axr">
              <input className="gw-inp" aria-label="회신" placeholder="회신 — 연락처는 1:1 대화로" value={draft[r.id] ?? ''} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} />
              <button type="button" className="gw-bo gw-sm" onClick={async () => { const t = (draft[r.id] ?? '').trim(); if (t.length < 2) return; const x = await post(`/api/v1/biz/axis-requests/${r.id}/answer`, { answer: t }); if (x.ok) void load(); }}>회신</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
