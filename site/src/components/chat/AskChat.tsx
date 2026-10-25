'use client';
/**
 * SB-HOM-MCH-010 1:1 문의 — v10.31 시안 scAsk 의 가운데 · 오른쪽:
 *   대화 머리(상대 · 인증 표시 · 활동지역 · 신고) · 대화(날짜 구분 · 말풍선 · 시각) · 보내기 전 경고 상자(수정하겠습니다 · 그래도 보내기) ·
 *   보내기 줄(첨부 ＋ · 보낼 내용 · 전송) · 안내 · 오른쪽 거래 정보 · 소개 귀속 · 예상 소개비 · 계약서 요청하기.
 * 대화를 여는 · 불러오는 · 보내는 방법은 ChatPanel 과 같습니다(첫 메시지 = 대화 생성 · 이미 있으면 그 대화).
 * 보내기 전 확인: POST /conversations/check — 계좌번호 · 연락처 · 플랫폼 밖 거래 표현 · 금지어가 있으면 한 번 묻습니다(저장 안 함).
 * 첨부: 파일 저장소의 대화 첨부 용도가 아직 없어 단추는 안내만 합니다(시안과 같은 문구 — 되는 척하지 않음).
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { dtKst, hmKst, won, ymdKst } from '@/lib/format';

interface Message { id: number; senderId: string; body: string; createdAt: string; masked: boolean; mine?: boolean }
export interface ConvSummary {
  conversationId: string; status: string; createdAt: string; role: 'INITIATOR' | 'OWNER';
  counterpart: { name: string; business: boolean; identityVerified: boolean; region: string | null } | null;
  deal: { id: string; status: string; statusLabel: string | null; createdAt: string } | null;
  attribution: { code: string; introducer: string | null; model: string; fixed: boolean; since: string; validUntil: string | null } | null;
  fee: { amount: number | null; agreed: boolean; bearerLabel: string | null };
}
interface Check { warn: boolean; reasons: Array<{ code: string; label: string; hits: string[] }> }

const dealNo = (id: string) => `D-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
/* v10.31 검정(G-222) — toLocale… 는 서버(Node) · 브라우저가 다른 글자를 내 수화 오류가 납니다 → 한국 시각 도우미(lib/format)로 같은 글자 */
const ymd = (s: string) => { const [y, m, d] = ymdKst(s).split('-'); return y && m && d ? `${y}년 ${Number(m)}월 ${Number(d)}일` : ''; };
const hm = (s: string) => hmKst(s);

export function AskChat({ listingId, conversationId: initialConv, canDeal, listingFee, bearerLabel }: {
  listingId: string; conversationId?: string | null; canDeal: boolean; listingFee?: number | null; bearerLabel?: string | null;
}) {
  const router = useRouter();
  const t = useTranslations('deal.chat');
  const [convId, setConvId] = useState<string | null>(initialConv ?? null);
  const [sum, setSum] = useState<ConvSummary | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [warn, setWarn] = useState<Check | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [dealBusy, setDealBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (id: string) => {
    const [m, s] = await Promise.all([
      fetch(`/api/v1/conversations/${id}/messages`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/v1/conversations/${id}/summary`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setMsgs(Array.isArray(m) ? m : []); if (s) setSum(s);
  }, []);

  useEffect(() => {
    let stop = false;
    (async () => {
      let id = initialConv ?? null;
      if (!id) {
        const r = await fetch(`/api/v1/me/conversations?role=SENT&listingId=${encodeURIComponent(listingId)}`).catch(() => null);
        const list = r && r.ok ? await r.json().catch(() => []) : [];
        id = Array.isArray(list) && list[0]?.id ? list[0].id : null;
      }
      if (stop || !id) return;
      setConvId(id); await load(id);
    })();
    return () => { stop = true; };
  }, [listingId, initialConv, load]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  async function deliver(body: string) {
    setErr(null);
    if (!convId) {
      const r = await fetch('/api/v1/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'LISTING', targetId: listingId, message: body }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('openFail')); setText(body); return; }
      const id = d?.conversationId ?? null;
      setConvId(id); if (id) await load(id);
      return;
    }
    const r = await fetch(`/api/v1/conversations/${convId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
    if (!r.ok) { const d = await r.json().catch(() => null); setErr(d?.message ?? t('sendFail')); setText(body); return; }
    await load(convId);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    start(async () => {
      /* 보내기 전 확인 — 경고가 있으면 상자를 띄우고 멈춥니다 */
      const c: Check | null = await fetch('/api/v1/conversations/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (c?.warn) { setWarn(c); return; }
      setText(''); await deliver(body);
    });
  }
  function sendAnyway() {
    const body = text.trim(); setWarn(null);
    if (!body) return;
    start(async () => { setText(''); await deliver(body); });
  }

  async function requestContract() {
    if (!convId) { setErr(t('startFirst')); return; }
    setDealBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/conversations/${convId}/deal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.dealId) { setErr(d?.message ?? (r.status === 403 ? t('idRequired') : t('dealFail'))); return; }
      router.push(`/deal/${d.dealId}/contract`);
    } finally { setDealBusy(false); }
  }

  /* 날짜가 바뀌는 곳에 구분선 */
  const rows: Array<{ day?: string; m?: Message }> = [];
  let last = '';
  for (const m of msgs) { const d = ymd(m.createdAt); if (d !== last) { rows.push({ day: d }); last = d; } rows.push({ m }); }
  const cp = sum?.counterpart;
  const reportHref = `/support/new?type=DISPUTE${sum?.deal ? `&deal=${sum.deal.id}` : ''}#inquiry`;

  return (
    <div className="w1-chw">
      <section className="w1-ask chat" aria-label={t('aria')}>
        <div className="chh">
          <span className="av" aria-hidden="true">{(cp?.name ?? '?').slice(0, 1)}</span>
          <div className="ci">
            <b>{cp?.name ?? t('other')}{cp?.business ? <span className="vf">{t('bizVerified')}</span> : cp?.identityVerified ? <span className="vf">{t('idVerified')}</span> : null}</b>
            <span>{cp?.region ? t('region', { region: cp.region }) : t('kept')}</span>
          </div>
          <Link className="rp" href={reportHref}>{t('report')}</Link>
        </div>
        <div className="chb chat-log" data-chat-log="">
          {rows.length === 0 && <p className="w1-empty" style={{ margin: 20 }}>{t('emptyLong')}</p>}
          {rows.map((r, i) => r.day
            ? <div key={`d${i}`} className="dv"><span>{r.day}</span></div>
            : (
              <div key={r.m!.id} className={`msg ${r.m!.mine ? 'me' : 'them'}`} data-msg={r.m!.mine ? 'mine' : 'other'}>
                {!r.m!.mine && <span className="av sm" aria-hidden="true">{(cp?.name ?? '?').slice(0, 1)}</span>}
                <div className="bw"><div className="bb">{r.m!.body}</div>
                  <span className="tm">{hm(r.m!.createdAt)}{r.m!.masked ? t('maskedSuffix') : ''}</span></div>
              </div>
            ))}
          <div ref={endRef} />
        </div>

        {warn && (
          <div className="w1-wrn2" role="alertdialog" aria-label={t('warnAria')}>
            <b>{t('warnTitle')}</b>
            <span>{t.rich('warnBody', { list: warn.reasons.map((x) => `${x.label}(${x.hits.join(', ')})`).join(' · '), b: (x) => <b>{x}</b> })}</span>
            <div className="wb">
              <button type="button" className="w1-jb o" onClick={() => setWarn(null)}>{t('fix')}</button>
              <button type="button" className="w1-jb o" onClick={sendAnyway} disabled={pending}>{t('anyway')}</button>
            </div>
          </div>
        )}

        {/* chat-input · textarea · 첫 단추 = 전송 — 기존 시험(qa)이 쓰는 손잡이. 첨부 ＋ 는 단추 요소가 아닌 role=button */}
        <form className="chi chat-input" onSubmit={send} noValidate>
          <span className="at" role="button" tabIndex={0} aria-label={t('attach')}
            onClick={() => setTip(t('attachTip'))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTip(t('attachTip')); } }}>＋</span>
          <textarea className="w1-in" name="m" aria-label={t('input')} value={text} maxLength={2000} rows={1}
            onChange={(e) => { setText(e.target.value); if (warn) setWarn(null); }} placeholder={t('input')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }} />
          <button className="snd" type="submit" disabled={pending || !text.trim()}>{pending ? '…' : t('submit')}</button>
        </form>
        <div className="chn">{tip ?? t('foot')}</div>
        {err && <p className="w1-err form-error" role="alert" style={{ margin: '0 14px 12px' }}>{err}</p>}
      </section>

      <aside className="w1-chs">
        <div className="sp1"><div className="sh3">{t('dealInfo')}</div>
          {sum?.deal ? (
            <dl className="kv"><dt>{t('dealNo')}</dt><dd className="mo">{dealNo(sum.deal.id)}</dd>
              <dt>{t('state')}</dt><dd><span className="w1-bg ok">{sum.deal.statusLabel ?? sum.deal.status}</span></dd>
              <dt>{t('started')}</dt><dd>{dtKst(sum.deal.createdAt)}</dd></dl>
          ) : (
            <dl className="kv"><dt>{t('dealNo')}</dt><dd>{t('none')}</dd><dt>{t('state')}</dt><dd><span className="w1-bg off">{convId ? t('inquiring') : t('before')}</span></dd>
              {sum && <><dt>{t('started')}</dt><dd>{dtKst(sum.createdAt)}</dd></>}</dl>
          )}
        </div>
        <div className="sp1"><div className="sh3">{t('attr')} <span className="qm" title={t('attrTip')}>?</span></div>
          {sum?.attribution ? (
            <>
              <dl className="kv"><dt>{t('refCode')}</dt><dd className="mo">{sum.attribution.code}</dd>
                <dt>{t('introducer')}</dt><dd>{sum.attribution.introducer ?? '—'}</dd>
                <dt>{t('attrModel')}</dt><dd>{sum.attribution.model === 'FIRST_TOUCH' ? 'first-touch' : sum.attribution.model}{sum.attribution.fixed ? t('fixed') : ''}</dd>
                {sum.attribution.validUntil && <><dt>{t('valid')}</dt><dd>{t('until', { date: ymd(sum.attribution.validUntil) })}</dd></>}</dl>
              <div className="nt2">{t.rich('payTo', { name: sum.attribution.introducer ?? t('introducer'), b: (x) => <b>{x}</b> })}</div>
            </>
          ) : <div className="nt2">{t('noAttr')}</div>}
        </div>
        <div className="sp1"><div className="sh3">{t('feeTitle')}</div>
          <div className="fee2"><b>{(sum?.fee.amount ?? listingFee) ? won((sum?.fee.amount ?? listingFee)!) : t('feeNeg')}</b>
            <span>{sum?.fee.agreed ? t('agreed') : t('desired')}{(sum?.fee.bearerLabel ?? bearerLabel) ? ` · ${sum?.fee.bearerLabel ?? bearerLabel}` : ''}{t('vat')}</span></div>
          <div className="nt2">{t.rich('feeNote', { b: (x) => <b>{x}</b> })}</div>
        </div>
        {canDeal ? (
          <button type="button" className="nx" onClick={() => void requestContract()} disabled={dealBusy} data-request-contract="">{dealBusy ? t('opening') : t('reqContract')}</button>
        ) : (
          <div className="nt2">{t.rich('needId', { b: (x) => <b>{x}</b>, link: (x) => <Link href="/verify">{x}</Link> })}</div>
        )}
        <div className="nt3">{t.rich('formOnly', { b: (x) => <b>{x}</b> })}</div>
      </aside>
    </div>
  );
}
