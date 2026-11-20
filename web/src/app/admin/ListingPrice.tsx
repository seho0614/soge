/* ===== v10.549 ~ 552 (D286 · docs/687 ~ 690) (56) 매물 3 — web/src/app/admin/ListingPrice.tsx 새 파일 =====
 *   LpxOffers  검수 › 매물 가격 제안 — 스위치 · 관별 스위치(SUPER · 처음 모두 꺼짐) · 기한 · 하한 · 개수 · 최근 30일 상태별 수 · 최근 제안 100(가린 이름 · 메모 없음) · 정기 작업 지금 한 번(SUPER)
 *   LpxPhoto   검수 › 매물 사진 워터마크 — 스위치 · 자리 · 진하기 · 미리보기(화면 겹침 · 원본 사진 그대로)
 *   LpxAway    검수 › 판매자 자리 비움 — 스위치 · 최대 일수 · 켜 둔 수 · 자동 안내 수(길별) · 최근 100(가린 이름 · 기간 · 안내 글 없음)
 *   LpxStats   검수 › 지역별 시세 통계 — 스위치 · 최소 수 · 달 수 · 달별 칸 수 · 매물 많은 칸 100 · 지금 셈(SUPER)
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · 기존 클래스(card · tbl · btn-sm · warn-text · muted)만 — 새 CSS 없음 · 인라인은 폭 · 자리 · 허용 글자 크기 · 토큰 색만
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { isSuperNow } from './OpsStaffBoxes';

const won = (v: unknown) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR'));
const thisYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);

interface Settings { offerOn: boolean; offerGwans: string[]; offerDays: number; offerMinPct: number; offerMemberMax: number; offerCounterMax: number;
  markOn: boolean; markPos: string; markOpacity: number; awayOn: boolean; awayMaxDays: number; statsOn: boolean; statsMin: number; statsMonths: number }
type Key = Exclude<keyof Settings, 'offerGwans' | 'markPos'>;

/** 설정 한 상자 — 스위치 · 숫자 · 사유(SUPER 만 저장 · 보낸 칸만) */
function SettingsBox({ s, keys, onDone, tag, extra }: { s: Settings; keys: Array<[Key, string, number?, number?]>; onDone: () => void; tag: string; extra?: Partial<Settings> }) {
  const a = useAct();
  const [v, setV] = useState<Partial<Settings>>({});
  const [reason, setReason] = useState('');
  const sup = isSuperNow();
  const body = { ...v, ...(extra ?? {}) };
  const save = () => void a.run(`set${tag}`, () => api('/admin/lpx/settings', { method: 'PUT', body: JSON.stringify({ ...body, reason }) }), () => { setV({}); setReason(''); onDone(); });
  return (
    <div className="card" data-lpx-settings={tag}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        {keys.map(([k, label, lo, hi]) => {
          const cur = (v[k] ?? s[k]) as boolean | number;
          return (
            <tr key={k}><td>{label}</td><td>
              {typeof s[k] === 'boolean'
                ? <label><input type="checkbox" disabled={!sup} checked={!!cur} onChange={(e) => setV({ ...v, [k]: e.target.checked } as Partial<Settings>)} /> {cur ? '켜짐' : '꺼짐'}</label>
                : <input type="number" disabled={!sup} min={lo} max={hi} value={Number(cur)} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) } as Partial<Settings>)} style={{ width: 120 }} />}
            </td></tr>
          );
        })}
      </tbody></table>
      {sup ? (
        <p>
          <input placeholder="사유(2 ~ 200자 · 설정 바뀜 기록)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 320 }} />{' '}
          <button className="btn-sm" disabled={!Object.keys(body).length || reason.trim().length < 2 || a.busy === `set${tag}`} onClick={save} data-lpx-save={tag}>저장</button>
        </p>
      ) : <p className="muted">설정은 SUPER 만 바꿉니다.</p>}
    </div>
  );
}

/* ── 매물 가격 제안 ── */
interface OfferView { settings: Settings; gwans: Array<{ code: string; name: string; on: boolean }>; summary30: Record<string, number | string | null>;
  recent: Array<{ id: string; state: string; askingAmount: string | null; amount: string; counterAmount: string | null; finalAmount: string | null; counterCount: number; decidedBy: string | null; createdAt: string; title: string; gwanCode: string; member: string }>; note: string }
const O_KO: Record<string, string> = { OPEN: '답 기다림', COUNTERED: '되제안', ACCEPTED: '수락', REJECTED: '거절', WITHDRAWN: '거둠', EXPIRED: '기한 지남' };

/** 관별 스위치 — 가격 제안을 쓰는 관(lpx.offer_gwans) · SUPER 만 저장 · 사유 */
function GwanBox({ gwans, onDone }: { gwans: OfferView['gwans']; onDone: () => void }) {
  const a = useAct();
  const [on, setOn] = useState<string[] | null>(null);
  const [reason, setReason] = useState('');
  const sup = isSuperNow();
  const cur = on ?? gwans.filter((g) => g.on).map((g) => g.code);
  const save = () => void a.run('gw', () => api('/admin/lpx/settings', { method: 'PUT', body: JSON.stringify({ offerGwans: cur, reason }) }), () => { setOn(null); setReason(''); onDone(); });
  return (
    <div className="card" data-lpx-gwans={cur.length}>
      <Flash msg={a.msg} err={a.err} />
      <p>관별 가격 제안(lpx.offer_gwans · 처음 모두 꺼짐) — 꺼진 관 매물은 제안을 서버와 DB 가 막습니다.</p>
      <p>{gwans.map((g) => (
        <label key={g.code} style={{ marginRight: 12 }}>
          <input type="checkbox" disabled={!sup} checked={cur.includes(g.code)} data-lpx-gwan={g.code}
            onChange={(e) => setOn(e.target.checked ? [...cur, g.code] : cur.filter((x) => x !== g.code))} /> {g.name}({g.code})
        </label>
      ))}</p>
      {sup ? (
        <p>
          <input placeholder="사유(2 ~ 200자 · 설정 바뀜 기록)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 320 }} />{' '}
          <button className="btn-sm" disabled={on === null || reason.trim().length < 2 || a.busy === 'gw'} onClick={save} data-lpx-gwan-save="">관별 저장</button>
        </p>
      ) : <p className="muted">관별 설정은 SUPER 만 바꿉니다.</p>}
    </div>
  );
}

export function LpxOffers() {
  const v = useApi<OfferView>('/admin/lpx/offers');
  const a = useAct();
  const d = v.data;
  if (!d) return <section data-lpx-offers="">{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;
  const s = d.summary30;
  return (
    <section data-lpx-offers={d.recent.length}>
      <Flash msg={a.msg} err={a.err} />
      <p className={d.settings.offerOn ? '' : 'warn-text'} data-lpx-offer-switch={d.settings.offerOn ? 'on' : 'off'}>
        {d.settings.offerOn ? '가격 제안 켜짐 — 켠 관의 게시 매물에 회원이 희망 가격을 제안합니다.' : '가격 제안 꺼짐(처음) — 켜기 전까지 매물 상세 · 나의공간에 칸이 보이지 않습니다.'}
      </p>
      <GwanBox gwans={d.gwans} onDone={v.reload} />
      <SettingsBox s={d.settings} tag="offer" onDone={v.reload} keys={[['offerOn', '가격 제안(lpx.offer)'], ['offerDays', '답 기한 일수', 1, 14], ['offerMinPct', '거래 금액 대비 하한(%) · 0 = 없음', 0, 99], ['offerMemberMax', '회원마다 열린 제안 수', 1, 50], ['offerCounterMax', '되제안 · 다시 제안 횟수(1 ~ 5 · DB 가 넘는 것을 막음)', 1, 5]]} />
      <p>최근 30일 — 답 기다림 {won(s.open)} · 되제안 {won(s.countered)} · 수락 {won(s.accepted)}(거래 금액 대비 평균 {s.acceptedPct ?? '—'}%) · 거절 {won(s.rejected)} · 거둠 {won(s.withdrawn)} · 기한 지남 {won(s.expired)}
        {isSuperNow() && <>{' '}<button className="btn-sm" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api<{ offers?: { expired: number }; away?: { ended: number } }>('/admin/lpx/offers/run', { method: 'POST' }), v.reload,
          (r) => `기한 지남 ${r?.offers?.expired ?? 0} · 자리 비움 정리 ${r?.away?.ended ?? 0}`)} data-lpx-run="">정기 작업 지금 한 번</button></>}
      </p>
      <table className="tbl" data-lpx-offer-list={d.recent.length}><thead><tr><th>번호</th><th>매물</th><th>관</th><th>거래 금액</th><th>제안</th><th>되제안</th><th>합의</th><th>회원</th><th>상태</th><th>제안한 때</th></tr></thead><tbody>
        {d.recent.length === 0 ? <tr><td colSpan={10} className="muted">아직 가격 제안이 없습니다.</td></tr> : d.recent.map((r) => (
          <tr key={r.id}><td>{r.id}</td><td>{r.title}</td><td>{r.gwanCode}</td><td>{won(r.askingAmount)}</td><td>{won(r.amount)}</td><td>{won(r.counterAmount)}{r.counterCount ? ` (${r.counterCount}번)` : ''}</td><td>{won(r.finalAmount)}</td><td>{r.member}</td>
            <td>{O_KO[r.state] ?? r.state}{r.decidedBy === 'SYSTEM' ? '(저절로)' : ''}</td><td>{ymdhm(r.createdAt)}</td></tr>
        ))}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── 매물 사진 워터마크 ── */
interface MarkView { settings: Settings; mark: { on: boolean; text: string; pos: string; opacity: number }; positions: string[]; published: { listings: number; photos: number }; sampleListingId: string | null; note: string }
const POS_KO: Record<string, string> = { BR: '오른쪽 아래', BL: '왼쪽 아래', TR: '오른쪽 위', TL: '왼쪽 위', C: '가운데', TILE: '여러 번' };
const POS_STYLE: Record<string, CSSProperties> = {
  BR: { right: 11, bottom: 11 }, BL: { left: 11, bottom: 11 }, TR: { right: 11, top: 11 }, TL: { left: 11, top: 11 }, C: { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' },
};

/** 미리보기 — 사용자 웹과 같은 자리 · 진하기(회색 칸 위) */
function MarkPreview({ text, pos, opacity }: { text: string; pos: string; opacity: number }) {
  const label = (k: string | number, st: CSSProperties) => (
    <span key={k} style={{ position: 'absolute', fontSize: 12, padding: '2px 8px', borderRadius: 999, background: 'var(--surface)', opacity: opacity / 100, pointerEvents: 'none', ...st }}>{text}</span>
  );
  return (
    <div data-lpx-mark-preview={pos} style={{ position: 'relative', width: 320, height: 200, borderRadius: 11, background: 'var(--g200)', overflow: 'hidden' }}>
      {pos === 'TILE'
        ? [0, 1, 2, 3, 4, 5].map((i) => label(i, { left: `${(i % 2) * 50 + 8}%`, top: `${Math.floor(i / 2) * 33 + 8}%`, transform: 'rotate(-20deg)' }))
        : label('one', POS_STYLE[pos] ?? POS_STYLE.BR!)}
    </div>
  );
}

export function LpxPhoto() {
  const v = useApi<MarkView>('/admin/lpx/watermark');
  const [pos, setPos] = useState<string | null>(null);
  const d = v.data;
  if (!d) return <section data-lpx-photo="">{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;
  const cur = pos ?? d.settings.markPos;
  return (
    <section data-lpx-photo={d.settings.markOn ? 'on' : 'off'}>
      <p className={d.settings.markOn ? '' : 'warn-text'} data-lpx-mark-switch={d.settings.markOn ? 'on' : 'off'}>
        {d.settings.markOn ? `워터마크 켜짐 — 매물 상세 사진 위에 「${d.mark.text}」 글자가 보입니다.` : '워터마크 꺼짐(처음) — 아래는 미리보기입니다.'}
        {' '}게시 중 사진 {won(d.published.photos)}장(매물 {won(d.published.listings)})
      </p>
      <p>자리 {d.positions.map((p) => (
        <label key={p} style={{ marginRight: 10 }}><input type="radio" name="lpx-pos" checked={cur === p} disabled={!isSuperNow()} onChange={() => setPos(p)} data-lpx-pos={p} /> {POS_KO[p] ?? p}</label>
      ))}</p>
      <MarkPreview text={d.mark.text} pos={cur} opacity={d.settings.markOpacity} />
      <SettingsBox s={d.settings} tag="mark" onDone={() => { setPos(null); v.reload(); }} extra={pos && pos !== d.settings.markPos ? { markPos: pos } : undefined}
        keys={[['markOn', '사진 워터마크(lpx.watermark)'], ['markOpacity', '진하기(10 ~ 60)', 10, 60]]} />
      {d.sampleListingId && <p className="muted">미리 볼 매물: {d.sampleListingId} — 사용자 웹 매물 상세에서 확인(켠 뒤).</p>}
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── 판매자 자리 비움 ── */
interface AwayView { settings: Settings; summary: Record<string, number>; via30: Array<{ via: string; n: number }>;
  recent: Array<{ id: string; startsOn: string; endsOn: string; state: string; createdAt: string; owner: string; listings: number; notices: number }>; note: string }
const A_KO: Record<string, string> = { ACTIVE: '켜짐', ENDED: '끝남(저절로)', CANCELLED: '회원이 끝냄' };
const VIA_KO: Record<string, string> = { CONVERSATION: '1:1 문의', QUESTION: '공개 질문', OFFER: '가격 제안', VISIT: '방문 예약' };

export function LpxAway() {
  const v = useApi<AwayView>('/admin/lpx/away');
  const d = v.data;
  if (!d) return <section data-lpx-away="">{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;
  const s = d.summary;
  return (
    <section data-lpx-away={d.recent.length}>
      <p className={d.settings.awayOn ? '' : 'warn-text'} data-lpx-away-switch={d.settings.awayOn ? 'on' : 'off'}>
        {d.settings.awayOn ? '자리 비움 켜짐 — 회원이 기간을 켜면 매물 상세에 보이고 문의 등에 자동 안내가 갑니다.' : '자리 비움 꺼짐(처음) — 켜기 전까지 회원이 켤 수 없고 표시 · 안내도 없습니다.'}
      </p>
      <SettingsBox s={d.settings} tag="away" onDone={v.reload} keys={[['awayOn', '판매자 자리 비움(lpx.away)'], ['awayMaxDays', '한 번 최대 일수', 1, 90]]} />
      <p>켜 둔 것 {won(s.active)}(지금 보이는 것 {won(s.showing)}) · 최근 30일 만든 것 {won(s.made30)} · 자동 안내 {won(s.notices30)}
        {d.via30.length > 0 && <> — {d.via30.map((x) => `${VIA_KO[x.via] ?? x.via} ${x.n}`).join(' · ')}</>}</p>
      <table className="tbl" data-lpx-away-list={d.recent.length}><thead><tr><th>번호</th><th>회원</th><th>기간</th><th>게시 매물</th><th>자동 안내</th><th>상태</th><th>켠 때</th></tr></thead><tbody>
        {d.recent.length === 0 ? <tr><td colSpan={7} className="muted">아직 자리 비움이 없습니다.</td></tr> : d.recent.map((r) => (
          <tr key={r.id}><td>{r.id}</td><td>{r.owner}</td><td>{r.startsOn} ~ {r.endsOn}</td><td>{r.listings}</td><td>{r.notices}</td><td>{A_KO[r.state] ?? r.state}</td><td>{ymdhm(r.createdAt)}</td></tr>
        ))}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── 지역별 시세 통계 ── */
interface StatsView { settings: Settings; ym: string; months: Array<{ ym: string; cells: number; smallCells: number; computedAt: string }>;
  top: Array<{ gwanCode: string; category: string; categoryName: string; sido: string; sigungu: string; n: number; median: string }>; note: string }

export function LpxStats() {
  const [ym, setYm] = useState(thisYm());
  const v = useApi<StatsView>(`/admin/lpx/stats?ym=${ym}`, [ym]);
  const a = useAct();
  const d = v.data;
  if (!d) return <section data-lpx-stats="">{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;
  return (
    <section data-lpx-stats={d.top.length}>
      <Flash msg={a.msg} err={a.err} />
      <p className={d.settings.statsOn ? '' : 'warn-text'} data-lpx-stats-switch={d.settings.statsOn ? 'on' : 'off'}>
        {d.settings.statsOn ? '시세 통계 켜짐 — 매일 04:50 모으고 공개 화면 · API 에 집계만 보입니다.' : '시세 통계 꺼짐(처음) — 「지금 셈」으로 미리 모아 볼 수 있고, 공개는 켠 뒤입니다.'}
      </p>
      <SettingsBox s={d.settings} tag="stats" onDone={v.reload} keys={[['statsOn', '지역별 시세 통계(lpx.stats)'], ['statsMin', '공개 칸 최소 매물 수(5 이상)', 5, 50], ['statsMonths', '달별 추이 달 수', 3, 24]]} />
      <p>
        <label>달 <input type="month" value={ym} onChange={(e) => setYm(e.target.value || thisYm())} style={{ width: 160 }} /></label>
        {isSuperNow() && <>{' '}<button className="btn-sm" disabled={a.busy === 'run'} data-lpx-stats-run=""
          onClick={() => void a.run('run', () => api<{ months: number; rows: number }>('/admin/lpx/stats/run', { method: 'POST', body: JSON.stringify({ ym }) }), v.reload, (r) => `${r?.months ?? 0}달 · 칸 ${r?.rows ?? 0}`)}>이 달 지금 셈</button>
          {' '}<button className="btn-sm" disabled={a.busy === 'all'}
          onClick={() => void a.run('all', () => api<{ months: number; rows: number }>('/admin/lpx/stats/run', { method: 'POST', body: '{}' }), v.reload, (r) => `${r?.months ?? 0}달 · 칸 ${r?.rows ?? 0}`)}>이번 달 · 지난달 · 빠진 달</button></>}
      </p>
      <table className="tbl"><thead><tr><th>달</th><th>칸</th><th>5개 미만(값 없음)</th><th>모은 때</th></tr></thead><tbody>
        {d.months.length === 0 ? <tr><td colSpan={4} className="muted">아직 모은 달이 없습니다.</td></tr> : d.months.map((m) => (
          <tr key={m.ym}><td>{m.ym}</td><td>{won(m.cells)}</td><td>{won(m.smallCells)}</td><td>{ymdhm(m.computedAt)}</td></tr>
        ))}
      </tbody></table>
      <table className="tbl" data-lpx-stats-top={d.top.length}><thead><tr><th>관</th><th>업종</th><th>지역</th><th>매물</th><th>가운데값(원)</th></tr></thead><tbody>
        {d.top.length === 0 ? <tr><td colSpan={5} className="muted">{d.ym} 에 값이 있는 칸이 없습니다.</td></tr> : d.top.map((r, i) => (
          <tr key={i}><td>{r.gwanCode}</td><td>{r.categoryName}</td><td>{[r.sido || '전국', r.sigungu].filter(Boolean).join(' ')}</td><td>{won(r.n)}</td><td>{won(r.median)}</td></tr>
        ))}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}
