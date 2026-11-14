import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymd, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface TypeRate {
  sellerType: 'BRAND' | 'TENANT'; rate: string | number | null; note: string | null; updatedAt: string;
  sellers: number; ownRate: number; changes: number;
}
export interface RateImpact {
  scope: string; key: string; rate: number | null; days: number;
  lines: number; orders: number; sales: number; recorded: number; nowFee: number; newFee: number; diff: number; note: string;
  increase?: boolean; affected?: number; needsNotice?: boolean; earliest?: string; scheduled?: { id: string; effectiveDate: string } | null;
}
/** v10.275 (D208) 미리보기 결과 — false 면 그만둠 · effectiveDate 가 있으면 예약(올림 · 영향받는 판매자 있음) */
export type ImpactChoice = false | { effectiveDate?: string };
interface RateSchedule {
  id: string; scope: 'SELLER' | 'TYPE' | 'CATEGORY'; target: string; label: string | null;
  fromRate: string | number | null; toRate: string | number | null; effectiveDate: string; reason: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELED'; notified: number; affectedNow: number;
  createdAt: string; appliedAt: string | null; canceledAt: string | null; cancelReason: string | null; by: string | null;
  /** v10.278 (D209) 별도 공지 — 예약 안내 · 취소 안내(초안 → 「공지 게시」) */
  noticeId: string | null; noticeTitle: string | null; noticeBody: string | null; noticePublishedAt: string | null;
  cancelNoticeId: string | null; cancelNoticeTitle: string | null; cancelNoticeBody: string | null; cancelNoticePublishedAt: string | null;
  noticeLate: boolean;
  /** v10.283 (D212) 읽음 n / 대상 m · 다시 알림 */
  noticeReads?: number; remindedAt?: string | null; reminds?: number;
}
const SCOPE_NAME: Record<string, string> = { SELLER: '판매자', TYPE: '입점 유형', CATEGORY: '갈래' };
const pct = (v: string | number | null) => (v === null ? '비움(다음 순서)' : `${Number(v)}%`);

export const TYPE_NAME: Record<string, string> = { BRAND: '브랜드 직영관', TENANT: '일반 입점' };

/**
 * v10.274 (docs/404) — 요율을 바꾸기 전 영향 미리보기(읽기만). 최근 30일 결제된 주문 줄을 지금 요율 · 새 요율로 셈.
 *   바꾸기 단추(갈래 · 입점 유형 · 판매자)가 저장 전에 부르고, 확인 창에 보여 줍니다. 미리보기가 안 되면 그 사실만 알리고 계속할지 묻습니다.
 * v10.276 (D208 · docs/406) — 올라가고 영향받는 판매자가 있으면 「예약」을 알리고 시행일(가장 이른 날 = 오늘 + 31일)을 묻습니다(약관 제17조 4항).
 */
export async function previewImpact(scope: 'SELLER' | 'TYPE' | 'CATEGORY', key: string, rate: number | null, label: string): Promise<ImpactChoice> {
  const q = `scope=${scope}&key=${encodeURIComponent(key)}&rate=${rate === null ? '' : rate}`;
  try {
    const r = await api<RateImpact>(`/admin/health/rate-impact?${q}`);
    const sign = r.diff > 0 ? '+' : '';
    const body = r.lines
      ? `최근 ${r.days}일 실제 주문(${n(r.orders)}건 · 판매액 ${n(r.sales)}원)에 적용하면\n`
        + `  지금 요율 수수료 ${n(r.nowFee)}원 → 새 요율 ${n(r.newFee)}원 (${sign}${n(r.diff)}원)\n`
        + '이미 받은 주문의 수수료는 바뀌지 않습니다 — 새 주문부터 적용.'
      : `최근 ${r.days}일 동안 이 요율이 쓰인 주문이 없습니다 — 새 주문부터 적용.`;
    if (r.scheduled) { alert(`${label} — 이미 ${r.scheduled.effectiveDate} 시행 예약이 있습니다. 「요율 변경 예정」에서 취소한 뒤 바꾸십시오.`); return false; }
    const notice = r.needsNotice
      ? `\n\n⚠ 올리는 변경 — 판매자 ${n(r.affected ?? 0)}곳에 30일 전에 알려야 합니다(입점 약관 제17조 4항).\n바로 바꾸지 않고 「예약」합니다 — 다음 창에서 시행일(${r.earliest} 이후)을 정합니다.`
      : '';
    if (!confirm(`${label} → ${rate === null ? '비움(다음 순서 요율)' : `${rate}%`}\n\n${body}${notice}\n\n${r.needsNotice ? '예약할까요?' : '바꿀까요?'}`)) return false;
    if (!r.needsNotice) return {};
    const d = (prompt(`시행일(YYYY-MM-DD · 한국 0시부터 새 주문에 적용) — ${r.earliest} 이후`, r.earliest ?? '') ?? '').trim();
    if (!d) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (r.earliest && d < r.earliest)) { alert(`시행일은 ${r.earliest} 이후 날짜(YYYY-MM-DD)로 적어 주십시오.`); return false; }
    return { effectiveDate: d };
  } catch {
    return confirm(`${label} — 영향 미리보기를 불러오지 못했습니다.\n그래도 바꿀까요?`) ? {} : false;
  }
}

/**
 * SB-ADM-HST-010 소개몰 정산 › 요율 변경 예정 (v10.276 · D208 · docs/406)
 *   판매자 · 입점 유형 · 갈래 요율 인상 예약 — 시행 전에만 취소(사유 · 판매자에게 알림). 시행일 0시부터 새 주문에 적용 · 매일 00:05 표에 옮김.
 * v10.278 (D209 · docs/407) — 줄마다 별도 공지: 「공지 안 함」(빨강) · 「공지 게시」(본문 확인 뒤 · 게시한 날 + 31일 ≤ 시행일) · 취소 뒤 「변경 취소 안내」.
 */
export function HealthRateSchedules({ onChanged }: { onChanged?: () => void }) {
  const q = useApi<RateSchedule[]>('/admin/health/rate-schedules');
  const a = useAct();
  const rows = q.data ?? [];
  const open = rows.filter((r) => r.status === 'SCHEDULED');
  const cancel = (r: RateSchedule) => {
    const reason = prompt(`${r.label ?? r.target} ${pct(r.fromRate)} → ${pct(r.toRate)} (${r.effectiveDate} 시행) 예약을 취소합니다.\n취소 사유(2자 이상) — 판매자에게 알림이 갑니다`) ?? '';
    if (reason.trim().length < 2) return;
    void a.run(`sch:${r.id}`, () => api<{ note: string }>(`/admin/health/rate-schedules/${r.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }),
      () => { q.reload(); onChanged?.(); }, (x) => x.note);
  };
  const st: Record<string, string> = { SCHEDULED: '예정', APPLIED: '시행함', CANCELED: '취소' };
  const publish = (r: RateSchedule, cancel: boolean) => {
    const title = cancel ? r.cancelNoticeTitle : r.noticeTitle, body = cancel ? r.cancelNoticeBody : r.noticeBody;
    if (!confirm(`아래 공지를 소개몰 공지(맨 위 고정)로 게시합니다 — 파트너센터 공지 · 판매자센터에 보입니다.\n\n[${title}]\n${body}\n\n게시할까요?`)) return;
    void a.run(`ntc:${r.id}`, () => api<{ note: string }>(`/admin/health/rate-schedules/${r.id}/notice`, { method: 'POST' }),
      () => q.reload(), (x) => x.note);
  };
  /* v10.283 (D212) — 공지를 판매자센터에서 펼치지 않은 영향 판매자에게만 다시 알림(24시간에 한 번) */
  const remind = (r: RateSchedule, unread: number) => {
    if (!confirm(`「${r.noticeTitle}」 공지를 아직 펼쳐 보지 않은 판매자 ${unread}곳에 다시 알립니다(24시간에 한 번 · 기록이 남음). 보낼까요?`)) return;
    void a.run(`rmd:${r.id}`, () => api<{ note: string }>(`/admin/health/rate-schedules/${r.id}/remind`, { method: 'POST' }), () => q.reload(), (x) => x.note);
  };
  const noticeCell = (r: RateSchedule) => {
    if (r.status === 'CANCELED' && r.cancelNoticeId) {
      return r.cancelNoticePublishedAt ? <span className="dim">취소 안내 게시 {ymd(r.cancelNoticePublishedAt)}</span>
        : <button className="btn-plain" disabled={a.busy === `ntc:${r.id}`} onClick={() => publish(r, true)} data-rate-notice-publish={r.id}>취소 안내 게시</button>;
    }
    if (!r.noticeId) return <span className="dim">—</span>;
    if (r.noticePublishedAt) {
      const unread = Math.max(0, (r.affectedNow ?? 0) - (r.noticeReads ?? 0));
      const soon = !!r.remindedAt && Date.now() - new Date(r.remindedAt).getTime() < 24 * 3600 * 1000;
      return (
        <>
          <span data-rate-notice="published">게시 {ymd(r.noticePublishedAt)}</span>{' '}
          <span className="dim" data-rate-notice-reads={`${r.noticeReads ?? 0}/${r.affectedNow ?? 0}`}>· 읽음 {r.noticeReads ?? 0} / 대상 {r.affectedNow ?? 0}</span>
          {r.status === 'SCHEDULED' && unread > 0 && (
            soon ? <span className="dim"> · 다시 알림 {ymd(r.remindedAt)}(24시간 뒤 다시)</span>
              : <> <button className="btn-plain" disabled={a.busy === `rmd:${r.id}`} onClick={() => remind(r, unread)} data-rate-notice-remind={r.id}>안 읽은 {unread}곳 다시 알림</button></>
          )}
          {(r.reminds ?? 0) > 0 && !soon && <span className="dim"> · 다시 알림 {r.reminds}번</span>}
        </>
      );
    }
    if (r.status !== 'SCHEDULED') return <span className="dim">게시 안 함</span>;
    return (
      <>
        <span className="badge badge-urgent" data-rate-notice="missing">공지 안 함</span>{' '}
        {r.noticeLate ? <span className="dim">30일이 남지 않음 — 취소하고 다시 예약</span>
          : <button className="btn-plain" disabled={a.busy === `ntc:${r.id}`} onClick={() => publish(r, false)} data-rate-notice-publish={r.id}>공지 게시</button>}
      </>
    );
  };
  return (
    <div className="card pad" data-rate-schedules={open.length} style={{ margin: '10px 0' }}>
      <b>요율 변경 예정</b> <span className="dim">— 입점 약관 제17조 4항 · 올리면 30일 전 공지 · 개별 알림 · 시행일 0시부터 새 주문에 적용 · 시행 전에만 취소</span>
      <Flash msg={a.msg} err={a.err} />
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : rows.length === 0 ? (
        <p className="dim" style={{ marginTop: 6 }} data-rate-schedule-empty>예약한 요율 변경이 없습니다. 요율을 올릴 때 영향받는 판매자가 있으면 여기에 예약으로 쌓입니다.</p>
      ) : (
        <table className="tbl" style={{ marginTop: 6 }}>
          <thead><tr><th>범위</th><th>대상</th><th>지금 → 새</th><th>시행일</th><th>상태</th><th>알린 판매자</th><th>공지</th><th>사유</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-rate-schedule={r.status}>
                <td>{SCOPE_NAME[r.scope]}</td>
                <td>{r.label ?? <span className="mono">{r.target}</span>}</td>
                <td className="num-cell">{pct(r.fromRate)} → <b>{pct(r.toRate)}</b></td>
                <td className="mono">{r.effectiveDate}</td>
                <td>{st[r.status]}{r.status === 'CANCELED' && r.cancelReason ? <span className="dim"> · {r.cancelReason}</span> : null}</td>
                <td className="num-cell">{n(r.notified)}곳{r.status === 'SCHEDULED' ? <span className="dim"> (지금 {n(r.affectedNow)}곳)</span> : null}</td>
                <td>{noticeCell(r)}</td>
                <td className="dim">{r.reason}</td>
                <td>{r.status === 'SCHEDULED' && <button className="btn-plain" disabled={a.busy === `sch:${r.id}`} onClick={() => cancel(r)} data-rate-schedule-cancel={r.id}>취소</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * SB-ADM-HST-010 소개몰 정산 › 입점 유형 요율 (v10.272 · D206 · docs/404)
 *   약관 제17조(입점 유형별 요율)와 맞춤 — 순서: 판매자 지정 → 입점 유형 → 갈래 → 기본 → 10%. 비어 있으면 갈래 요율을 씁니다.
 */
export function HealthTypeRates({ onChanged }: { onChanged?: () => void } = {}) {
  const q = useApi<TypeRate[]>('/admin/health/type-rates');
  const a = useAct();
  const change = async (t: TypeRate) => {
    const raw = prompt(`${TYPE_NAME[t.sellerType]} 판매수수료율(%) — 0 ~ 50 · 비우면 갈래 요율 · 새 주문부터 적용`, t.rate === null ? '' : String(Number(t.rate)));
    if (raw === null) return;
    const v = raw.trim() === '' ? null : Number(raw);
    if (v !== null && !(v >= 0 && v <= 50)) { alert('0 ~ 50 사이 숫자로 적어 주십시오.'); return; }
    const p = await previewImpact('TYPE', t.sellerType, v, TYPE_NAME[t.sellerType]!);
    if (!p) return;
    const reason = prompt(p.effectiveDate ? '바꾸는 사유(2자 이상) — 판매자에게 알림으로 보이고 기록에 남습니다' : '바꾸는 사유(2자 이상) — 기록에 남습니다') ?? '';
    if (reason.trim().length < 2) return;
    void a.run(`type:${t.sellerType}`, () => api<{ note: string }>(`/admin/health/type-rates/${t.sellerType}`, { method: 'PATCH', body: JSON.stringify({ rate: v, reason: reason.trim(), ...p }) }),
      () => { q.reload(); onChanged?.(); }, (r) => r.note);
  };
  return (
    <div className="card pad" data-type-rates={(q.data ?? []).map((t) => `${t.sellerType}:${t.rate === null ? '-' : Number(t.rate)}`).join('|')} style={{ margin: '10px 0' }}>
      <b>입점 유형 요율</b> <span className="dim">— 입점 약관 제17조 · 순서: 판매자 지정 → <b>입점 유형</b> → 갈래 → 기본 → 10% · 비어 있으면 갈래 요율</span>
      <Flash msg={a.msg} err={a.err} />
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : (
        <table className="tbl" style={{ marginTop: 6 }}>
          <thead><tr><th>입점 유형</th><th>요율</th><th>판매자(판매 중 · 정지)</th><th>판매자 지정 요율 있음</th><th>바꾼 기록</th><th>바꾼 때</th><th /></tr></thead>
          <tbody>
            {(q.data ?? []).map((t) => (
              <tr key={t.sellerType} data-type-rate={t.sellerType}>
                <td>{TYPE_NAME[t.sellerType]} <span className="mono dim">{t.sellerType}</span></td>
                <td className="num-cell">{t.rate === null ? <span className="dim">비어 있음(갈래 요율)</span> : <b>{Number(t.rate)}%</b>}</td>
                <td className="num-cell">{n(t.sellers)}곳</td>
                <td className="num-cell">{t.ownRate ? `${n(t.ownRate)}곳(그 요율이 먼저)` : '—'}</td>
                <td className="num-cell">{t.changes ? `${t.changes}건` : '—'}</td>
                <td className="dim">{t.changes ? ymdhm(t.updatedAt) : '—'}</td>
                <td><button className="btn-plain" disabled={a.busy === `type:${t.sellerType}`} onClick={() => void change(t)} data-type-rate-edit={t.sellerType}>바꾸기</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="dim" style={{ marginTop: 4 }}>바꾸기 전에 최근 30일 실제 주문으로 수수료가 얼마 달라지는지 먼저 보여 줍니다(저장 전 확인 창). 이미 받은 주문은 그대로입니다. 올리는데 영향받는 판매자가 있으면 바로 바꾸지 않고 30일 뒤로 예약합니다(아래 「요율 변경 예정」).</p>
    </div>
  );
}
