'use client';
/**
 * v10.29 — 매물 상세(SB-{G}-DTL-010)의 브라우저 쪽 부품을 시안 모양(.abar · .dtprof 단추 · .qna)으로.
 * 동작 · API · 단추 글자는 기존 부품(components/listing/DetailBar · components/Questions)과 같습니다 — 모양만 시안입니다.
 *   GwDetailBar   맨 아래 줄  [♡ 관심 담기] [💬 질문 N] [↗ 공유하기] [신고]        [1:1 문의 시작]
 *   GwProfileActions  등록자 카드의 [💬 질문하기] [📞 전화하기]
 *   GwQna         문의 내용(공개 문의) — 목록 · 문의 남기기 · 등록자 답변
 */
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ago } from '@/lib/format';

const GATE: Record<string, { href: string; label: string }> = {
  IDENTITY_REQUIRED: { href: '/verify', label: '본인인증 후 문의할 수 있습니다' },
  OWN_LISTING: { href: '', label: '내가 등록한 매물입니다' },
};

export function GwDetailBar({ id, path, loggedIn, liked, canInquire, blockReason, questionCount, ctaNote }: {
  id: string; path: string; loggedIn: boolean; liked: boolean; canInquire: boolean; blockReason?: string; questionCount: number;
  /** v10.31 — 단추 아래 글(운영 문구 CTA_ATTRIBUTION · 시안 「대화가 시작되면 소개코드가 발급됩니다」) */
  ctaNote?: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(liked);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { setOn(liked); }, [liked]);

  function like() {
    setMsg(null);
    if (!loggedIn) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
    start(async () => {
      /* 메서드를 글자 그대로 둡니다 — 매트릭스(scripts/gen-matrix.js)가 소스를 읽어 「화면 → API」를 잇기 때문입니다. */
      const r = on
        ? await fetch(`/api/v1/me/favorites/${id}`, { method: 'DELETE' })
        : await fetch(`/api/v1/me/favorites/${id}`, { method: 'POST' });
      if (r.status === 401) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setMsg(d?.message ?? '처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
        return;
      }
      setOn(!on);
      router.refresh();
    });
  }
  async function share() {
    const url = window.location.href;
    try { await navigator.clipboard.writeText(url); setMsg('주소를 복사했습니다. 붙여 넣어 보내십시오.'); }
    catch { setMsg(`이 주소를 복사해 보내십시오 — ${url}`); }
  }
  const gate = blockReason ? GATE[blockReason] : null;

  return (
    <>
      <div className="gw-abar" data-detail-bar="" id="ask">
        <button type="button" className={`gw-bo${on ? ' gw-on' : ''}`} aria-pressed={on} disabled={pending} onClick={like}>
          {on ? '♥ 관심 담김' : '♡ 관심 담기'}
        </button>
        <a className="gw-bo" href="#qna">💬 질문 {questionCount}</a>
        <button type="button" className="gw-bo" onClick={share}>↗ 공유하기</button>
        <Link className="gw-bo gw-rp" href={`/report/listing/${id}`} prefetch={false}>신고</Link>
        <span className="gw-sp" />
        {/* v10.31 (시안 기준) — 단추는 늘 시안의 주황 「1:1 문의 시작」. 아직 문의할 수 없으면 누를 때 무엇이 먼저인지 알리고 그 화면으로 보냅니다(로그인 · 본인인증 · 사업자 전환) */}
        {canInquire ? (
          <button type="button" className="gw-go" onClick={() => router.push(`/chat/${id}`)}>
            <span>1:1 문의 시작</span><small>{ctaNote ?? '대화가 시작되면 소개코드가 발급됩니다'}</small>
          </button>
        ) : blockReason === 'OWN_LISTING' ? (
          <button type="button" className="gw-go gw-off" disabled><span>{gate?.label}</span></button>
        ) : (
          <button type="button" className="gw-go" data-gate={blockReason ?? ''}
                  onClick={() => { setMsg(gate?.label ?? '문의할 수 없습니다'); router.push(!loggedIn ? `/login?next=${encodeURIComponent(path)}` : gate?.href || path); }}>
            <span>1:1 문의 시작</span><small>{!loggedIn ? '로그인 · 본인인증 후 문의할 수 있습니다' : gate?.label ?? ''}</small>
          </button>
        )}
      </div>
      {msg && <p className="gw-barmsg" role="status">{msg}</p>}
    </>
  );
}

export function GwProfileActions() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <a className="gw-bq" href="#qna">💬 질문하기</a>
      <button type="button" className="gw-bcall"
              onClick={() => setMsg('전화 연결은 준비 중입니다. 지금은 1:1 문의로 시작해 주십시오 — 대화가 시작되면 소개가 기록됩니다.')}>
        📞 전화하기
      </button>
      {msg && <p className="gw-profmsg" role="status">{msg}</p>}
    </>
  );
}

interface Question {
  id: string; question: string; answer: string | null;
  answeredAt: string | null; askerName: string; createdAt: string; canAnswer: boolean;
}

/** 공개 문의(SB-HOM-MCH-020) — 서버가 연락처를 가려 내려줍니다. 화면에서 다시 가공하지 않습니다. */
export function GwQna({ listingId, canAsk, notice, allHref }: { listingId: string; canAsk: boolean; notice?: string; allHref?: string }) {
  const [rows, setRows] = useState<Question[]>([]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const load = () =>
    fetch(`/api/v1/listings/${listingId}/questions`).then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, [listingId]);   // eslint-disable-line react-hooks/exhaustive-deps

  function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const q = String(new FormData(form).get('question') ?? '');
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/listings/${listingId}/questions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }),
      });
      if (!r.ok) { const d = await r.json().catch(() => null); setErr(d?.message ?? '등록하지 못했습니다.'); return; }
      form.reset(); await load();
    });
  }
  function answer(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const a = String(new FormData(e.currentTarget).get('answer') ?? '');
    start(async () => {
      const r = await fetch(`/api/v1/listings/questions/${id}/answer`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: a }),
      });
      if (!r.ok) { const d = await r.json().catch(() => null); setErr(d?.message ?? '답변하지 못했습니다.'); return; }
      setAnswering(null); await load();
    });
  }

  return (
    <div className="gw-qna" id="qna">
      <div className="gw-qh" id="qsec"><span>문의 내용 <span className="gw-n">💬 질문 {rows.length}</span></span>
        {/* v10.32 — 시안 공개 문의 단독 화면(SB-HOM-MCH-020)으로 */}
        {allHref && <Link href={allHref} className="gw-qlink" data-qna-all="" prefetch={false}>전체 보기 →</Link>}</div>
      <div style={{ marginTop: 8 }}>
        {rows.length === 0 ? (
          <div className="gw-qi"><span>아직 문의가 없습니다. 첫 문의를 남겨 보세요.</span><span /></div>
        ) : rows.map((q) => (
          <div key={q.id} className="gw-qrowx">
            <div className="gw-qi"><span>💬 {q.question} <i className="gw-qwho">— {q.askerName}</i></span><span suppressHydrationWarning>{ago(q.createdAt)}</span></div>
            {q.answer ? (
              <div className="gw-qa"><b>답변</b> {q.answer}</div>
            ) : q.canAnswer ? (
              answering === q.id ? (
                <form className="gw-qform" onSubmit={(e) => answer(q.id, e)}>
                  <textarea name="answer" rows={2} required placeholder="답변을 입력하세요" />
                  <button className="gw-bo gw-sm" disabled={pending}>등록</button>
                </form>
              ) : <button type="button" className="gw-qlink" onClick={() => setAnswering(q.id)}>답변하기</button>
            ) : null}
          </div>
        ))}
      </div>
      {canAsk ? (
        <form className="gw-qform" onSubmit={ask}>
          <textarea name="question" rows={2} required placeholder="매물에 대해 궁금한 점을 남겨 주세요" />
          <button className="gw-bo gw-sm" disabled={pending}>{pending ? '등록 중…' : '문의 등록'}</button>
        </form>
      ) : (
        <p className="gw-qhint">본인인증 후 문의를 남길 수 있습니다.</p>
      )}
      {err && <p className="gw-qerr" role="alert">{err}</p>}
      <div className="gw-note">ⓘ {notice ?? '공개 문의는 누구나 볼 수 있습니다. 연락처는 자동으로 가려집니다.'}</div>
    </div>
  );
}

/** v10.31 — 큰 사진 넘기기(시안 「1/5」). 사진은 서버 공개 주소(GET /listings/{id}/photos/{n}) · 없으면 분류 그림 1장 */
export function GwPhotos({ urls, fallback, alt, status }: { urls: string[]; fallback: string; alt: string; status: string }) {
  const [i, setI] = useState(0);
  const list = urls.length ? urls : [fallback];
  const n = list.length;
  return (
    <div className="gw-dtimg" data-photos={urls.length}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="gw-thp" src={list[i]} alt={urls.length ? `${alt} — 사진 ${i + 1}` : `${alt} — 분류 그림`} />
      <span className="gw-st2">{status}</span>
      {n > 1 && (
        <>
          <button type="button" className="gw-phv gw-prev" aria-label="이전 사진" onClick={() => setI((i - 1 + n) % n)}>‹</button>
          <button type="button" className="gw-phv gw-next" aria-label="다음 사진" onClick={() => setI((i + 1) % n)}>›</button>
        </>
      )}
      <span className="gw-ix">{i + 1}/{n}</span>
    </div>
  );
}
