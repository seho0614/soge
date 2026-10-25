import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { label } from '../../lib/codes';
import { remain } from '../../lib/format';
import { ErrorView } from '../../components/ErrorView';
import { Badge } from '../../components/Badge';

/** SB-ADM-REV-010 검수 큐 — v10.29 시안(scAdmRev) 모양: 상태 탭 · 줄(.qrow) · 아래 안내
 *  v10.31 — 시안대로 탭 「대기 · SLA 임박 · 반려」, 줄 제목 = 매물 제목 · 등록자, 줄의 「승인」. 안내 「자동 안내가 나갑니다」는
 *  서버 sla_alert 작업이 실제로 보냅니다(D082). */

interface ReviewItem {
  id: string;
  targetType: string;
  targetId: string;
  gwanCode: string | null;
  submittedAt: string;
  slaDueAt: string;
  status: string;
  decisionMode: 'MANUAL' | 'AUTO';
  manualReasons: string[] | null;
  rejectReasonCode: string | null;
  rejectReasonLabel?: string | null;
  decidedAt: string | null;
  /* v10.31 — 서버가 붙여 주는 대상 제목 · 업종 · 등록자(시안 줄) */
  targetTitle?: string | null;
  categoryName?: string | null;
  submitterName?: string | null;
  /* v10.106 (D120) — AI 검수 보조 의견(참고만) */
  aiSuggestion?: 'APPROVE' | 'REJECT' | 'UNSURE' | null;
  aiReasonCodes?: string[] | null;
}
/** v10.106 (D120) — AI 의견 표시(참고만 · AI 는 승인 · 반려하지 않음) */
const AI_TXT: Record<string, string> = { APPROVE: '승인 제안', REJECT: '반려 제안', UNSURE: '모름' };
const AI_CLS: Record<string, string> = { APPROVE: 'ok', REJECT: 'no', UNSURE: '' };
interface Counts { pending: number; slaSoon: number; slaOver: number; rejected: number }
interface Throughput {
  day: string; submitted: number; decided: number;
  pending: number; slaBreached: number; avgHours: number | null;
}

export function ReviewQueue({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [stat, setStat] = useState<Throughput | null>(null);
  const [gwan, setGwan] = useState<string>('');
  const [st, setSt] = useState<'all' | 'soon' | 'rejected'>('all');
  const [counts, setCounts] = useState<Counts | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /* v10.27 (G-201) — 거르개가 관 이름 대신 코드(MNY …)로 보였습니다(label('gwan.code') 자료가 없음).
   * 관 목록 · 이름을 서버(/gwans)에서 받습니다. 못 받으면 예전처럼 코드 4개로 그립니다. */
  const [gwans, setGwans] = useState<{ code: string; name: string }[]>([]);
  useEffect(() => {
    api<{ code: string; name: string; isActive?: boolean }[]>('/gwans')
      /* 검수 대상이 아닌 갈래(EARN 소개하고 벌기 · LED 소개리드 — 검수 항목이 생기지 않음)는 뺍니다 */
      .then((g) => setGwans(g.filter((x) => x.isActive !== false && !['EARN', 'LED'].includes(x.code))))
      .catch(() => setGwans([]));
  }, []);
  const gname = (c: string) => gwans.find((x) => x.code === c)?.name || label('gwan.code', c) || c;
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (gwan) qs.set('gwanCode', gwan);
    if (st === 'rejected') qs.set('status', 'REJECTED');
    Promise.all([
      api<{ items: ReviewItem[] }>(`/admin/reviews${qs.toString() ? `?${qs}` : ''}`),
      api<Throughput[]>('/admin/reviews/throughput'),
      api<Counts>(`/admin/reviews/counts${gwan ? `?gwanCode=${gwan}` : ''}`).catch(() => null),
    ])
      .then(([q, t, c]) => { setItems(q.items ?? []); setStat(t[0] ?? null); setCounts(c); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  };
  useEffect(load, [gwan, st === 'rejected']);

  /* v10.31 (10/10 시안 기준 — 정책 문구 「목록에서 바로 승인」) — 줄의 보라 「승인」. 반려는 사유를 골라야 하므로 「열기」에서만 */
  const approve = (id: string) => {
    setBusyId(id); setMsg(null);
    api(`/admin/reviews/${id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'APPROVED' }) })
      .then(() => { setMsg('승인했습니다 — 바로 노출됩니다.'); load(); })
      .catch((e: { body?: { message?: string } }) => setMsg(e?.body?.message ?? '승인하지 못했습니다.'))
      .finally(() => setBusyId(null));
  };

  if (error) return <ErrorView error={error} onRetry={load} />;

  /* v10.31 — 시안 탭(대기 · SLA 임박 · 반려). 숫자는 서버(/admin/reviews/counts), 반려 목록은 서버(status=REJECTED · 최근 30일).
   * 임박 = 남은 시간 4시간 미만(시안 기준). SLA 를 넘긴 줄은 붉게 강조합니다(시안 「초과 건은 행이 강조」). */
  const tagged = items.map((it) => {
    const ms = new Date(it.slaDueAt).getTime() - Date.now();
    return { it, r: remain(it.slaDueAt), soon: ms >= 0 && ms < 4 * 3_600_000 };
  });
  const cnt = {
    all: counts?.pending ?? (st === 'rejected' ? 0 : tagged.length),
    soon: counts?.slaSoon ?? tagged.filter((x) => x.soon).length,
    rejected: counts?.rejected ?? (st === 'rejected' ? tagged.length : 0),
  };
  const shown = tagged.filter((x) => st !== 'soon' || x.soon);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  return (
    <div data-review-queue>
      <div className="ad-flt" role="tablist" aria-label="검수 상태">
        {([['all', '대기', cnt.all], ['soon', 'SLA 임박', cnt.soon], ['rejected', '반려', cnt.rejected]] as const).map(([k, t, n]) => (
          <button key={k} role="tab" aria-selected={st === k} className={st === k ? 'on' : ''}
                  onClick={() => setSt(k)} data-rq-st={k}>{t}<i>{n}</i></button>
        ))}
      </div>

      {/* 관 거르개 — 개발에만 있음(시안은 관 칩만). 시험이 관 이름 단추를 누릅니다 */}
      <div className="ad-flt sm" aria-label="관">
        {/* ★ 관 코드를 박으면 관을 늘릴 때 그 관이 안 보입니다 —
            건강상품이 그렇게 빠져 있었습니다(함정 ⑦). */}
        {['', ...(gwans.length ? gwans.map((x) => x.code) : ['MNY', 'MAL', 'BIZ', 'HLT'])].map((g) => (
          <button key={g || 'all'} onClick={() => setGwan(g)} aria-current={gwan === g ? 'page' : undefined}
                  className={gwan === g ? 'on' : ''} data-rq-gwan={g || 'all'}>{g ? gname(g) : '전체'}</button>
        ))}
      </div>

      {loading && <p className="muted">불러오는 중…</p>}
      {msg && <div className="form-ok" role="status">{msg}</div>}

      <div>
        {shown.map(({ it, r, soon }) => (
          /* 시안 .qrow — [관 · 업종 칩 · 매물 제목 · 번호 · 등록자 · 접수] [SLA] [열기 · 승인]. 줄 아무 곳이나 눌러도 열립니다 */
          <article key={it.id} className={`card ad-qrow${it.status !== 'REJECTED' && r.over ? ' over' : ''}`} onClick={() => onOpen(it.id)}
                   data-review={it.id}>
            <div className="qt">
              <div className="lh">
                {it.gwanCode && <span className="ad-chip gw">{gname(it.gwanCode)}</span>}
                {it.categoryName
                  ? <span className="ad-chip">{it.categoryName}</span>
                  : <Badge domain="review.target_type" code={it.targetType} text={label('review.target_type', it.targetType)} />}
                {it.decisionMode === 'AUTO' && <span className="ad-chip">자동</span>}
                {it.status !== 'REJECTED' && it.aiSuggestion && (
                  <span className={`ad-chip ${AI_CLS[it.aiSuggestion] ?? ''}`} data-ai-suggestion={it.aiSuggestion} title="AI 검수 보조 의견 — 참고만, 결정은 검수자">AI {AI_TXT[it.aiSuggestion] ?? it.aiSuggestion}</span>
                )}
              </div>
              <b>{it.targetTitle || `${label('review.target_type', it.targetType)} 검수`}</b>
              {/* ★ 개입 사유를 카드에 직접 표시합니다.
                  검수자가 "왜 내가 이걸 보고 있는지"를 먼저 알아야 어디를 볼지 압니다. */}
              {it.manualReasons?.length ? (
                <span className="why">개입 사유 · {it.manualReasons.map((c) => label('review.manual_reason', c)).join(' · ')}</span>
              ) : null}
              {it.status === 'REJECTED' && (
                <span className="why">반려 · {it.rejectReasonLabel ?? it.rejectReasonCode}</span>
              )}
              <span className="ls">{it.id.slice(0, 8)}{it.submitterName ? ` · ${it.submitterName}` : ''} · 접수 {when(it.submittedAt)}
                {it.status === 'REJECTED' && ` · 반려 ${when(it.decidedAt)}`}</span>
            </div>
            <div className="qsla">
              {it.status === 'REJECTED'
                ? <b className="no">반려</b>
                : r.over
                ? <b className="no">SLA {r.text}</b>
                : <b className={soon ? 'warn' : ''}>잔여 {r.text.replace(' 남음', '')}</b>}
            </div>
            <div className="qact">
              <button className="btn-sm" onClick={(e) => { e.stopPropagation(); onOpen(it.id); }}>열기</button>
              {it.status !== 'REJECTED' && (
                <button className="btn-ok btn-sm" disabled={busyId === it.id} data-rq-approve={it.id}
                        onClick={(e) => { e.stopPropagation(); approve(it.id); }}>승인</button>
              )}
            </div>
          </article>
        ))}

        {!loading && shown.length === 0 && (
          <p className="ad-empty">
            {st === 'rejected' ? '최근 30일 반려한 건이 없습니다.'
              : items.length === 0 ? '대기 중인 검수 건이 없습니다. 자동 승인된 건은 표본 감사 탭에 있습니다.' : '이 상태의 검수 건이 없습니다.'}
          </p>
        )}
      </div>

      {/* 검수가 병목이므로 처리량을 상시 노출합니다 (서버 v_review_throughput · 오늘) */}
      <div className="ad-nt info" data-rq-stat>
        <b>SLA 24시간을 넘기면 등록자에게 자동 안내가 나갑니다.</b> 검수 인력 1명 · 일 50건 기준이며(B-09R), 하루 처리량이 50건을 넘기 시작하면 증원 시점입니다 (J-06).
        {stat && <> 최근 집계 — 접수 {stat.submitted} · 처리 {stat.decided} · 대기 {stat.pending} · SLA 위반 {stat.slaBreached}
          {stat.avgHours != null && <> · 평균 {stat.avgHours}시간</>}.</>}
      </div>
    </div>
  );
}

