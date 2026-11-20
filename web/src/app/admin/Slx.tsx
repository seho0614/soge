/* ===== v10.532 ~ 534 (D281 · docs/670 ~ 672) (51) 소개몰 · 파트너 — web/src/app/admin/Slx.tsx 새 파일 =====
 * 대표 11/20 「(51)」 — 「주문 받기」가 꺼진 지금은 운영 화면 관리부터(회원 화면은 판매자센터 월 정산서 · 파트너센터 성과 추이만).
 *   SlxStatements   소개몰 › 판매자 월 정산서 — 달 고르기 · 만들기 · 다시 셈 · 인쇄 · PDF(printDoc.ts) · 메일 지금 보내기(처음 꺼짐 · 같은 달 한 번)
 *   SlxReviewPoints 소개몰 › 리뷰 적립 — 스위치 · 금액 설정 · 최근 30일 · 기록 · 운영 회수(사유)
 *   SlxPartnerPerf  파트너사 › 파트너 성과 — 기간(30일 · 90일 · 12개월) · 요약 · 앞 기간 · 그래프 · 순위(누르면 그 파트너만)
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · 색 · 글자는 기존 클래스(card · tbl · btn-sm · warn-text · muted) · 그래프 색은 토큰(var(--pp) · var(--accent))만 — 어두운 테마 그대로
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { openPrint } from '../../lib/printDoc';

const won = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const prevYm = () => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const MAIL_KO: Record<string, string> = { NONE: '보내기 전', OFF: '메일 꺼짐', SENT: '보냄', FAILED: '실패', NO_ADDR: '주소 없음' };
const ST_KO: Record<string, string> = { DRAFT: '마감', CONFIRMED: '확정', PAID: '지급됨', CARRIED: '이월' };

/* ── 판매자 월 정산서 ── */
interface StmtRow { sellerId: string; code: string; name: string; type: string; status: string; id: string | null; made: boolean; weeks: number | null; gross: number | null; fee: number | null;
  feeVat: number | null; refund: number | null; net: number | null; carriedOut: number | null; paid: number | null; mailState: string | null; mailTo: string | null; mailedAt: string | null;
  mailError: string | null; madeAt: string | null; remadeAt: string | null }
interface StmtView { ym: string; mailOn: boolean; day: number; mailReady: boolean; mailReason: string | null; made: number; sent: number; items: StmtRow[]; note: string }
interface StmtLine { from: string; to: string; gross: number; fee: number; feeVat: number; refund: number; carriedIn: number; net: number; carriedOut: number; status: string; invoiceState: string; invoiceNo: string | null; items: number }
export interface StmtDoc { id: string | null; ym: string; seller: { code: string; name: string; bizRegNo: string | null; ceoName: string | null; ecomRegNo: string | null; addr: string | null };
  company: string; weeks: number; gross: number; fee: number; feeVat: number; refund: number; carriedIn: number; net: number; carriedOut: number; paid: number; lines: StmtLine[]; note: string; mailState: string }

/** 인쇄용 본문(A4) — 판매자센터 화면과 같은 칸 */
export function statementHtml(d: StmtDoc) {
  const w = (v: number) => esc(Number(v ?? 0).toLocaleString('ko-KR'));
  const rows = d.lines.map((l) => `<tr><td>${esc(l.from)} ~ ${esc(l.to)}</td><td class="r">${w(l.gross)}</td><td class="r">${w(l.fee)}</td><td class="r">${w(l.feeVat)}</td><td class="r">${w(l.refund)}</td>`
    + `<td class="r">${w(l.carriedIn)}</td><td class="r">${w(l.net)}</td><td>${esc(ST_KO[l.status] ?? l.status)}${l.invoiceNo ? ` · ${esc(l.invoiceNo)}` : ''}</td></tr>`).join('');
  return `<h1>월 정산서</h1>
    <table class="meta"><tbody>
      <tr><td>정산 달</td><td><b>${esc(d.ym)}</b> (주 정산 ${d.weeks}번)</td><td>지급하는 곳</td><td>${esc(d.company)}</td></tr>
      <tr><td>판매자</td><td>${esc(d.seller.name)} (${esc(d.seller.code)})</td><td>사업자등록번호</td><td>${esc(d.seller.bizRegNo ?? '—')}</td></tr>
      <tr><td>대표</td><td>${esc(d.seller.ceoName ?? '—')}</td><td>통신판매업 신고</td><td>${esc(d.seller.ecomRegNo ?? '—')}</td></tr>
    </tbody></table>
    <table><thead><tr><th>매출</th><th>판매수수료</th><th>수수료 부가세</th><th>환불 조정</th><th>지급액 합계</th><th>지급 끝남</th><th>다음 주로 이월</th></tr></thead>
      <tbody><tr class="total sum"><td class="r">${w(d.gross)}</td><td class="r">${w(d.fee)}</td><td class="r">${w(d.feeVat)}</td><td class="r">${w(d.refund)}</td><td class="r">${w(d.net)}</td><td class="r">${w(d.paid)}</td><td class="r">${w(d.carriedOut)}</td></tr></tbody></table>
    <table><thead><tr><th>주(월요일 시작)</th><th>매출</th><th>수수료</th><th>부가세</th><th>환불</th><th>이월 받음</th><th>지급액</th><th>상태 · 계산서</th></tr></thead><tbody>${rows || '<tr><td colspan="8">주 정산서가 없습니다.</td></tr>'}</tbody></table>
    <p class="small">${esc(d.note)} 금액 단위 원. 지급은 결제대행사가 판매자 하위가맹점으로 합니다.</p>`;
}

export function SlxStatements() {
  const [ym, setYm] = useState(prevYm());
  const v = useApi<StmtView>(`/admin/health/statements?ym=${ym}`, [ym]);
  const a = useAct();
  const d = v.data;
  const print = async (id: string) => {
    try {
      const doc = await api<StmtDoc>(`/admin/health/statements/${id}`);
      if (!openPrint({ title: `월정산서_${doc.ym}_${doc.seller.code}`, body: statementHtml(doc), kind: 'OTHER', sign: doc.company })) alert('팝업이 막혀 정산서 창을 열지 못했습니다 — 팝업 차단을 풀고 다시 누르십시오.');
    } catch { a.setErr('정산서를 읽지 못했습니다.'); }
  };
  const make = (sellerId?: string) => void a.run(`mk${sellerId ?? ''}`, () => api('/admin/health/statements/make', { method: 'POST', body: JSON.stringify(sellerId ? { ym, sellerId } : { ym }) }), v.reload);
  const send = (r: StmtRow) => r.id && confirm(`${r.name} ${ym} 정산서를 메일로 보냅니다. 같은 달은 다시 보내지 않습니다.`)
    && void a.run(`ml${r.id}`, () => api(`/admin/health/statements/${r.id}/mail`, { method: 'POST' }), v.reload);
  return (
    <section data-slx-statements={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="정산 달" />{' '}
        <button className="btn-sm" disabled={a.busy === 'mk'} onClick={() => make()} data-slx-stmt-make="">이 달 정산서 만들기 · 다시 셈</button>
      </p>
      {d && (
        <>
          <p className={d.mailOn ? '' : 'warn-text'} data-slx-stmt-mail={d.mailOn ? 'on' : 'off'}>
            메일 {d.mailOn ? '켜짐' : '꺼짐(mall.statement_mail)'} · 만드는 날 매달 {d.day}일 · 메일 준비 {d.mailReady ? '됨' : `안 됨${d.mailReason ? `(${d.mailReason})` : ''}`} · 만든 것 {d.made} · 보낸 것 {d.sent} — {d.note}
          </p>
          <table className="tbl"><thead><tr><th>판매자</th><th className="num">주</th><th className="num">매출</th><th className="num">수수료(부가세)</th><th className="num">환불</th><th className="num">지급액</th><th className="num">지급 끝남</th><th>메일</th><th /></tr></thead>
            <tbody>{d.items.map((r) => (
              <tr key={r.sellerId} data-slx-stmt-row={r.id ?? ''}>
                <td>{r.name} <span className="muted">{r.code}</span></td>
                <td className="num">{r.made ? r.weeks : '—'}</td><td className="num">{won(r.gross)}</td><td className="num">{won(r.fee)}{r.feeVat ? <span className="muted"> ({won(r.feeVat)})</span> : null}</td>
                <td className="num">{won(r.refund)}</td><td className="num"><b>{won(r.net)}</b></td><td className="num">{won(r.paid)}</td>
                <td>{r.made ? (MAIL_KO[r.mailState ?? 'NONE'] ?? r.mailState) : '안 만듦'}{r.mailTo ? <span className="muted"> {r.mailTo}</span> : null}{r.mailedAt ? <span className="muted"> {ymdhm(r.mailedAt)}</span> : null}
                  {r.mailError ? <div className="warn-text">{r.mailError}</div> : null}</td>
                <td>
                  {r.id && <button className="btn-sm btn-plain" onClick={() => void print(r.id!)} data-slx-stmt-print="">인쇄 · PDF</button>}{' '}
                  {r.mailState !== 'SENT' && <button className="btn-sm btn-plain" disabled={a.busy === `mk${r.sellerId}`} onClick={() => make(r.sellerId)}>{r.made ? '다시 셈' : '만들기'}</button>}{' '}
                  {r.id && r.mailState !== 'SENT' && d.mailOn && d.mailReady && <button className="btn-sm" disabled={a.busy === `ml${r.id}`} onClick={() => send(r)}>메일 보내기</button>}
                </td>
              </tr>))}
              {d.items.length === 0 && <tr><td colSpan={9} className="muted">이 달에는 입점 판매자의 주 정산서가 없습니다.</td></tr>}
            </tbody></table>
        </>
      )}
    </section>
  );
}

/* ── 리뷰 적립 ── */
interface RpRow { id: string; state: string; amount: number; photo: boolean; createdAt: string; revokedAt: string | null; revokeReason: string | null; revokedAmount: number | null;
  orderNo: string; member: string; reviewId: string | null; reviewState: string | null; rating: number | null; body: string | null; productCode: string | null; productName: string | null; photoUrl: string | null }
interface RpView { on: boolean; switchOn: boolean; pointsOn: boolean; text: number; photo: number; minLen: number; days: number; granted30: number; grantedAmount30: number; photos30: number;
  revoked30: number; revokedAmount30: number; rows: RpRow[]; note: string }

export function SlxReviewPoints() {
  const [state, setState] = useState('');
  const v = useApi<RpView>(`/admin/health/review-points${state ? `?state=${state}` : ''}`, [state]);
  const a = useAct();
  const d = v.data;
  const revoke = (r: RpRow) => {
    const reason = prompt(`${r.orderNo} 리뷰 적립 ${won(r.amount)}원을 회수합니다. 사유(2자 이상):`, '');
    if (reason && reason.trim().length >= 2) void a.run(`rv${r.id}`, () => api(`/admin/health/review-points/${r.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), v.reload);
  };
  return (
    <section data-slx-review-points={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'}>리뷰 적립 {d.switchOn ? '켜짐' : '꺼짐(mall.review_points)'} · 적립금 {d.pointsOn ? '켜짐' : '꺼짐(mall.points)'} — {d.note}</p>
          <table className="tbl"><tbody>
            <tr><th>글 리뷰</th><td className="num">{won(d.text)}원</td><th>사진 가산</th><td className="num">{won(d.photo)}원</td><th>최소 글자 · 기한</th><td>{d.minLen}자 · 구매확정 뒤 {d.days}일</td></tr>
            <tr><th>최근 30일 적립</th><td className="num">{won(d.granted30)}건 · {won(d.grantedAmount30)}원</td><th>사진 리뷰</th><td className="num">{won(d.photos30)}건</td><th>회수</th><td className="num">{won(d.revoked30)}건 · {won(d.revokedAmount30)}원</td></tr>
          </tbody></table>
          <p className="muted">금액 · 스위치는 정책 › 전체 설정의 mall.review_points* 에서 바꿉니다(사유 · 바뀐 기록). 한 주문에 한 번이고, 회수한 뒤에는 다시 주지 않습니다.</p>
          <p data-slx-rp-filter="">
            {[['', '모두'], ['GRANTED', '적립'], ['REVOKED', '회수']].map(([k, l]) => <button key={k} className={`btn-sm ${state === k ? '' : 'btn-plain'}`} onClick={() => setState(k ?? '')}>{l}</button>)}
          </p>
          <table className="tbl"><thead><tr><th>때</th><th>회원</th><th>주문</th><th>상품 · 리뷰</th><th className="num">금액</th><th>상태</th><th /></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} data-slx-rp-row={r.state}>
                <td>{ymdhm(r.createdAt)}</td><td>{r.member}</td><td>{r.orderNo}</td>
                <td>{r.productName ?? '—'} {r.rating ? `★${r.rating}` : ''} <span className="muted">{r.reviewId ? (r.body ?? '') : '(지운 리뷰)'}</span>
                  {r.photoUrl ? <> · <a href={r.photoUrl} target="_blank" rel="noreferrer">사진</a></> : null}</td>
                <td className="num">{won(r.amount)}{r.photo ? <span className="muted"> (사진)</span> : null}</td>
                <td>{r.state === 'GRANTED' ? '적립' : `회수 ${won(r.revokedAmount)}원`}{r.revokeReason ? <div className="muted">{r.revokeReason}</div> : null}</td>
                <td>{r.state === 'GRANTED' && <button className="btn-sm btn-plain" disabled={a.busy === `rv${r.id}`} onClick={() => revoke(r)}>회수</button>}</td>
              </tr>))}
              {d.rows.length === 0 && <tr><td colSpan={7} className="muted">기록이 없습니다.</td></tr>}
            </tbody></table>
        </>
      )}
    </section>
  );
}

/* ── 파트너 성과 ── */
interface PerfPoint { bucket: string; received: number; viewed: number; viewMinAvg: number | null; viewMinP50: number | null; confirmed: number; feeBilled: number | null; paidOut: number | null }
interface PerfSum { received: number; viewed: number; viewRate: number | null; viewMinAvg: number | null; viewMinP50: number | null; viewedIn1h: number; in1hRate: number | null; confirmed: number; convRate: number | null; feeBilled: number | null; paidOut: number | null }
interface PerfRank { partnerId: string; company: string; grade: string | null; status: string; received: number; viewed: number; viewMinAvg: number | null; confirmed: number; feeBilled: number; convRate: number | null }
interface PerfView { range: { period: string; unit: string; from: string; to: string }; series: PerfPoint[]; summary: PerfSum; prev: PerfSum; picked: { id: string; company: string } | null; sort: string; rank: PerfRank[]; note: string }

function PerfChart({ pts }: { pts: PerfPoint[] }) {
  const W = 640, H = 180, P = 34;
  const max = Math.max(1, ...pts.map((p) => p.received));
  const bw = (W - P * 2) / Math.max(1, pts.length);
  const y = (v: number) => H - P / 2 - (v / max) * (H - P);
  return (
    <figure className="card pad" style={{ margin: 0 }} data-slx-perf-chart={pts.length}>
      <figcaption><b>기간 그래프</b> <small style={{ color: 'var(--pp)', marginLeft: 8 }}>■ 받은 리드</small><small style={{ color: 'var(--accent)', marginLeft: 8 }}>● 성사</small></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="파트너 성과 기간 그래프">
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="currentColor" opacity={0.2} />
        <text x={2} y={y(max) + 4} fontSize={12} fill="currentColor" opacity={0.6}>{max}</text>
        {pts.map((p, i) => (
          <g key={p.bucket}>
            <rect x={P + i * bw + bw * 0.15} width={bw * 0.7} y={y(p.received)} height={Math.max(0, y(0) - y(p.received))} fill="var(--pp)" opacity={0.55}><title>{`${p.bucket} 받은 리드 ${p.received} · 열람 ${p.viewed} · 성사 ${p.confirmed}`}</title></rect>
            {p.confirmed > 0 && <circle cx={P + i * bw + bw / 2} cy={y(p.confirmed)} r={3} fill="var(--accent)" />}
            {(i % Math.ceil(pts.length / 7) === 0 || i === pts.length - 1) && <text x={P + i * bw + bw / 2} y={H - 2} fontSize={12} textAnchor="middle" fill="currentColor" opacity={0.6}>{p.bucket.slice(5)}</text>}
          </g>))}
      </svg>
    </figure>
  );
}

export function SlxPartnerPerf() {
  const [period, setPeriod] = useState('30d');
  const [sort, setSort] = useState('received');
  const [pid, setPid] = useState('');
  const v = useApi<PerfView>(`/admin/partner-perf?period=${period}&sort=${sort}${pid ? `&partnerId=${pid}` : ''}`, [period, sort, pid]);
  const d = v.data;
  const diff = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? '' : ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 1000) / 10}%)`);
  return (
    <section data-slx-ptn-perf={d ? d.series.length : ''}>
      <p>
        {[['30d', '30일'], ['90d', '90일'], ['12m', '12개월']].map(([k, l]) => <button key={k} className={`btn-sm ${period === k ? '' : 'btn-plain'}`} onClick={() => setPeriod(k ?? '')}>{l}</button>)}{' '}
        {pid && <button className="btn-sm btn-plain" onClick={() => setPid('')}>모두 합으로</button>}
      </p>
      {v.error ? <p className="warn-text">{String(v.error)}</p> : null}
      {d && (
        <>
          <p className="muted">{d.range.from} ~ {d.range.to} · {d.range.unit === 'day' ? '날마다' : d.range.unit === 'week' ? '주마다' : '달마다'} — {d.note}</p>
          <table className="tbl" data-slx-perf-sum=""><tbody>
            <tr><th>받은 리드</th><td className="num">{won(d.summary.received)}{diff(d.summary.received, d.prev.received)}</td><th>열람</th><td className="num">{won(d.summary.viewed)} ({d.summary.viewRate ?? '—'}%)</td>
              <th>성사 · 리드 전환</th><td className="num">{won(d.summary.confirmed)} ({d.summary.convRate ?? '—'}%){diff(d.summary.confirmed, d.prev.confirmed)}</td></tr>
            <tr><th>응답 속도(평균 · 가운데)</th><td className="num">{d.summary.viewMinAvg ?? '—'}분 · {d.summary.viewMinP50 ?? '—'}분</td><th>1시간 안 열람</th><td className="num">{d.summary.in1hRate ?? '—'}%</td>
              <th>이용료 확정 · 받은 정산</th><td className="num">{won(d.summary.feeBilled)}원 · {won(d.summary.paidOut)}원</td></tr>
          </tbody></table>
          <PerfChart pts={d.series} />
          <h4>순위 <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="순위 기준"><option value="received">받은 리드</option><option value="confirmed">성사</option><option value="fee">이용료</option></select></h4>
          <table className="tbl"><thead><tr><th>파트너</th><th>등급</th><th className="num">받은 리드</th><th className="num">열람</th><th className="num">응답(분)</th><th className="num">성사</th><th className="num">전환</th><th className="num">이용료</th></tr></thead>
            <tbody>{d.rank.map((r) => (
              <tr key={r.partnerId} data-slx-perf-rank="">
                <td><button className="btn-sm btn-plain" onClick={() => setPid(r.partnerId)}>{r.company}</button></td><td>{r.grade ?? '—'}</td>
                <td className="num">{won(r.received)}</td><td className="num">{won(r.viewed)}</td><td className="num">{r.viewMinAvg ?? '—'}</td><td className="num">{won(r.confirmed)}</td>
                <td className="num">{r.convRate == null ? '—' : `${r.convRate}%`}</td><td className="num">{won(r.feeBilled)}</td>
              </tr>))}
              {d.rank.length === 0 && <tr><td colSpan={8} className="muted">이 기간에는 기록이 없습니다.</td></tr>}
            </tbody></table>
        </>
      )}
    </section>
  );
}
