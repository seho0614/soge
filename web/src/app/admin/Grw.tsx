/* ===== v10.597 ~ 601 (docs/739 ~ 743) 16차 회원 · 성장 — web/src/app/admin/Grw.tsx 새 파일 =====
 *   GrwOps  회원 › 회원 성장(SB-ADM-GRW-010) — 칸 다섯 + 설정
 *     가입 퍼널(SB-ADM-GRW-020 · v10.597) · 첫 거래 안내(SB-ADM-GRW-030 · v10.598) · 알림 하루 요약(SB-ADM-GRW-040 · v10.599)
 *     여러 단계 추천 보상(SB-ADM-GRW-050 · v10.600 · 처음 꺼짐 · 법무 확인 필요) · 매물 충실도(SB-ADM-GRW-060 · v10.601 · 노출 순위 · 소개비에 쓰지 않음)
 *   모두 숫자만(누가 했는지 없음 · 여러 단계 보상 최근 줄은 가린 이름) · 설정 바꾸기는 SUPER + 사유
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · CSS 는 기존 클래스만(tbl · card · btn-sm · muted · warn-text · num · sec) — 새 색 · 글자 크기 없음
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { Flash } from '../../components/Flash';

const put = (path: string, body: unknown) => api(path, { method: 'PUT', body: JSON.stringify(body) });
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, 20) : '—');
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

interface Set_ { signupSteps: boolean; firstSteps: boolean; firstStepsDays: number; digest: boolean; tierReward: boolean; tierLegalOk: boolean; tierPoints: string; fillHelper: boolean }
interface Funnel {
  days: number; from: string; settings: { signupSteps: boolean; usageStats: boolean }; page: { signupViews: number; doneViews: number } | null;
  steps: Array<{ step: number; n: number; pct: number | null; dropPct: number | null }>;
  total: { signed: number; verified: number; active: number; dealt: number };
  bySource: Array<{ source: string; signed: number; verified: number; active: number; dealt: number; verifiedPct: number | null; activePct: number | null; dealtPct: number | null }>;
  daily: Array<{ day: string; signed: number; verified: number }>; note: string;
}
interface FirstStats { days: number; members: number; steps: Array<{ code: string; done: number; pct: number | null }>; allDone: number; hidden: number; settings: { firstSteps: boolean; firstStepsDays: number }; note: string }
interface Digest { settings: { digest: boolean }; members: number; sends7: number; items7: number; held7: number; emailReady: boolean; daily: Array<{ day: string; sends: number; items: number }>; job: string; note: string }
interface Tier {
  settings: { tierReward: boolean; tierLegalOk: boolean; tierPoints: string }; points: Array<{ level: number; points: number }>;
  rule: { monthlyCap: number | null; isActive: boolean } | null; direct: { isActive: boolean; points: number } | null;
  chains: { level2: number; level3: number; level4: number }; totals: { rewards: number; points: number; thisMonth: number };
  recent: Array<{ id: string; level: number; points: number; at: string; to: string; from: string }>; legal: string; note: string;
}
interface Fill { settings: { fillHelper: boolean }; listings: number; sampled: boolean; avg: number | null; bins: Array<{ label: string; n: number }>; missing: Array<{ code: string; w: number; missing: number }>; note: string }

const SRC_KO: Record<string, string> = { RECOMMEND: '추천 코드', REFCODE: '소개코드 링크', AD: '광고', DIRECT: '직접 · 그 밖' };
const STEP_KO: Record<number, string> = { 1: '가입 유형', 2: '기업 인증', 3: '정보 적기', 4: '약관 동의', 5: '관심 성향' };
const FIRST_KO: Record<string, string> = { VERIFY: '본인인증', PROFILE: '관심 성향', LIKE: '관심 담기', ASK: '첫 문의', POST: '매물 · 요청 등록', DEAL: '첫 거래', NOTIFY: '알림 설정', SHARE: '추천 코드 나눔' };
const FILL_KO: Record<string, string> = { TITLE: '제목 10 ~ 60자', SUMMARY: '한 줄 요약', BODY: '본문 200자 이상', PHOTO1: '사진 1장', PHOTO3: '사진 3장 이상', REGION: '지역', AMOUNT: '거래 금액', FEE: '희망 소개비 · 부담 쪽', HOURS: '연락 가능 시간' };
const PARTS = [['funnel', '가입 퍼널'], ['first', '첫 거래 안내'], ['digest', '알림 하루 요약'], ['tier', '여러 단계 추천 보상'], ['fill', '매물 충실도'], ['set', '설정']] as const;
type Part = (typeof PARTS)[number][0];

export function GrwOps() {
  const [part, setPart] = useState<Part>('funnel');
  return (
    <section data-grw-ops={part}>
      <p>{PARTS.map(([k, label]) => (
        <button key={k} className={part === k ? 'btn-sm' : 'btn-sm btn-plain'} style={{ marginRight: 6 }} onClick={() => setPart(k)} data-grw-part={k}>{label}</button>
      ))}</p>
      {part === 'funnel' && <FunnelBox />}
      {part === 'first' && <FirstBox />}
      {part === 'digest' && <DigestBox />}
      {part === 'tier' && <TierBox />}
      {part === 'fill' && <FillBox />}
      {part === 'set' && <SettingsBox />}
    </section>
  );
}

/* ── v10.597 가입 퍼널 ── */
function FunnelBox() {
  const [days, setDays] = useState('30');
  const q = useApi<Funnel>(`/admin/grw/funnel?days=${days}`, [days]);
  const d = q.data;
  return (
    <div className="card" data-screen="SB-ADM-GRW-020" data-grw-funnel={d ? d.total.signed : ''}>
      <h3 className="sec">가입 퍼널 <select value={days} onChange={(e) => setDays(e.target.value)} data-grw-funnel-days="">{['7', '30', '90'].map((x) => <option key={x} value={x}>최근 {x}일</option>)}</select></h3>
      {!d ? <p className="muted">불러오는 중…</p> : (
        <>
          <table className="tbl"><tbody>
            <tr><th>가입 화면 본 수</th><td className="num">{d.page ? `${n(d.page.signupViews)} → 가입 끝 화면 ${n(d.page.doneViews)}` : <span className="muted">화면 사용 통계가 꺼져 있음</span>}</td></tr>
            <tr><th>가입 단계</th><td data-grw-steps="">{d.settings.signupSteps || d.steps.some((s) => s.n) ? d.steps.map((s) => `${STEP_KO[s.step]} ${n(s.n)}${s.dropPct != null ? `(이탈 ${s.dropPct}%)` : ''}`).join(' → ') : <span className="muted">가입 단계 수 세기가 꺼져 있음(설정)</span>}</td></tr>
            <tr><th>가입 → 본인인증 → 첫 활동 → 첫 거래</th><td className="num" data-grw-total="">{n(d.total.signed)} → {n(d.total.verified)} → {n(d.total.active)} → {n(d.total.dealt)}</td></tr>
          </tbody></table>
          <h3 className="sec">유입 경로별</h3>
          <table className="tbl"><thead><tr><th>경로</th><th className="num">가입</th><th className="num">본인인증</th><th className="num">첫 활동</th><th className="num">첫 거래</th></tr></thead>
            <tbody>{d.bySource.map((r) => (
              <tr key={r.source} data-grw-src={r.source}><td>{SRC_KO[r.source] ?? r.source}</td><td className="num">{n(r.signed)}</td>
                <td className="num">{n(r.verified)} ({pct(r.verifiedPct)})</td><td className="num">{n(r.active)} ({pct(r.activePct)})</td><td className="num">{n(r.dealt)} ({pct(r.dealtPct)})</td></tr>))}</tbody></table>
          <h3 className="sec">날마다 가입</h3>
          {d.daily.length === 0 ? <p className="muted">이 기간 가입이 없습니다.</p> : (
            <table className="tbl"><thead><tr><th>날</th><th className="num">가입</th><th className="num">본인인증</th></tr></thead>
              <tbody>{d.daily.map((r) => <tr key={r.day}><td>{r.day}</td><td className="num">{n(r.signed)}</td><td className="num">{n(r.verified)}</td></tr>)}</tbody></table>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </div>
  );
}

/* ── v10.598 첫 거래 안내 ── */
function FirstBox() {
  const [days, setDays] = useState('30');
  const q = useApi<FirstStats>(`/admin/grw/first-steps?days=${days}`, [days]);
  const d = q.data;
  return (
    <div className="card" data-screen="SB-ADM-GRW-030" data-grw-first={d ? d.members : ''}>
      <h3 className="sec">첫 거래 안내 <select value={days} onChange={(e) => setDays(e.target.value)}>{['30', '60', '90'].map((x) => <option key={x} value={x}>최근 {x}일 가입</option>)}</select></h3>
      {!d ? <p className="muted">불러오는 중…</p> : (
        <>
          <p>카드 {d.settings.firstSteps ? <b>보임</b> : <span className="muted">꺼짐</span>} · 가입 뒤 {n(d.settings.firstStepsDays)}일까지 · 대상 {n(d.members)}명 · 다 끝냄 {n(d.allDone)} · 그만 보기 {n(d.hidden)}</p>
          <table className="tbl"><thead><tr><th>단계</th><th className="num">끝낸 사람</th><th className="num">비율</th></tr></thead>
            <tbody>{d.steps.map((s) => <tr key={s.code} data-grw-first-step={s.code}><td>{FIRST_KO[s.code] ?? s.code}</td><td className="num">{n(s.done)}</td><td className="num">{pct(s.pct)}</td></tr>)}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </div>
  );
}

/* ── v10.599 알림 하루 요약 ── */
function DigestBox() {
  const q = useApi<Digest>('/admin/grw/digest');
  const d = q.data;
  return (
    <div className="card" data-screen="SB-ADM-GRW-040" data-grw-digest={d ? d.members : ''}>
      <h3 className="sec">알림 하루 요약</h3>
      {!d ? <p className="muted">불러오는 중…</p> : (
        <>
          <table className="tbl"><tbody>
            <tr><th>스위치</th><td>{d.settings.digest ? <b>켜짐</b> : <span className="muted">꺼짐(처음)</span>} · {d.job}</td></tr>
            <tr><th>켠 회원</th><td className="num">{n(d.members)}</td></tr>
            <tr><th>최근 7일</th><td className="num">요약 {n(d.sends7)}통 · 묶은 알림 {n(d.items7)}건 · 묶어 닫은 메일 {n(d.held7)}통</td></tr>
            <tr><th>메일</th><td>{d.emailReady ? '준비됨 — 요약도 메일로 감' : <span className="muted">준비 전 — 사이트 알림만</span>}</td></tr>
          </tbody></table>
          {d.daily.length > 0 && (
            <table className="tbl"><thead><tr><th>날</th><th className="num">요약</th><th className="num">알림</th></tr></thead>
              <tbody>{d.daily.map((r) => <tr key={r.day}><td>{r.day}</td><td className="num">{n(r.sends)}</td><td className="num">{n(r.items)}</td></tr>)}</tbody></table>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </div>
  );
}

/* ── v10.600 여러 단계 추천 보상 ── */
function TierBox() {
  const q = useApi<Tier>('/admin/grw/tier');
  const d = q.data;
  return (
    <div className="card" data-screen="SB-ADM-GRW-050" data-grw-tier={d ? (d.settings.tierReward ? 'on' : 'off') : ''}>
      <h3 className="sec">여러 단계 추천 보상(처음 꺼짐)</h3>
      {!d ? <p className="muted">불러오는 중…</p> : (
        <>
          <p className="warn-text" data-grw-tier-legal="">{d.legal}</p>
          <table className="tbl"><tbody>
            <tr><th>스위치</th><td>{d.settings.tierReward ? <b>켜짐</b> : <span className="muted">꺼짐</span>} · 법무 확인 끝 {d.settings.tierLegalOk ? <b>예</b> : <span className="muted">아니요</span>}</td></tr>
            <tr><th>점수</th><td>{d.points.map((p) => `${p.level}단계 ${n(p.points)}점`).join(' · ')} · 한 사람 한 달 {d.rule?.monthlyCap ? `${n(d.rule.monthlyCap)}번` : '제한 없음'} · 현금화 안 됨</td></tr>
            <tr><th>직접 추천 보상(1단계)</th><td>{d.direct ? (d.direct.isActive ? `켜짐 · ${n(d.direct.points)}점` : '꺼짐') : '—'} <span className="muted">(추천 · 제휴 › 추천 보상 규칙에서)</span></td></tr>
            <tr><th>지금 관계</th><td className="num">2단계 {n(d.chains.level2)} · 3단계 {n(d.chains.level3)} · 4단계 {n(d.chains.level4)}</td></tr>
            <tr><th>준 보상</th><td className="num">{n(d.totals.rewards)}건 · {n(d.totals.points)}점 · 이번 달 {n(d.totals.thisMonth)}건</td></tr>
          </tbody></table>
          {d.recent.length > 0 && (
            <table className="tbl"><thead><tr><th>때</th><th>단계</th><th>받은 분</th><th>가입한 분</th><th className="num">점수</th></tr></thead>
              <tbody>{d.recent.map((r) => <tr key={r.id}><td>{dt(r.at)}</td><td>{r.level}</td><td>{r.to}</td><td>{r.from}</td><td className="num">{n(r.points)}</td></tr>)}</tbody></table>
          )}
          <p className="muted">{d.note} 켜고 끄기 · 점수는 「설정」 칸(SUPER).</p>
        </>
      )}
    </div>
  );
}

/* ── v10.601 매물 충실도 ── */
function FillBox() {
  const q = useApi<Fill>('/admin/grw/fill');
  const d = q.data;
  return (
    <div className="card" data-screen="SB-ADM-GRW-060" data-grw-fill={d ? d.listings : ''}>
      <h3 className="sec">매물 충실도(게시 중)</h3>
      {!d ? <p className="muted">불러오는 중…</p> : (
        <>
          <p>회원 안내 {d.settings.fillHelper ? <b>보임</b> : <span className="muted">꺼짐</span>} · 매물 {n(d.listings)}{d.sampled ? '(최근 5,000개)' : ''} · 평균 {d.avg ?? '—'}점</p>
          <table className="tbl"><thead><tr><th>점수</th><th className="num">매물</th></tr></thead>
            <tbody>{d.bins.map((b) => <tr key={b.label} data-grw-fill-bin={b.label}><td>{b.label}</td><td className="num">{n(b.n)}</td></tr>)}</tbody></table>
          <h3 className="sec">많이 빠진 칸</h3>
          <table className="tbl"><thead><tr><th>칸</th><th className="num">무게</th><th className="num">빠진 매물</th></tr></thead>
            <tbody>{[...d.missing].sort((a, b) => b.missing - a.missing).map((m) => <tr key={m.code}><td>{FILL_KO[m.code] ?? m.code}</td><td className="num">{m.w}</td><td className="num">{n(m.missing)}</td></tr>)}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </div>
  );
}

/* ── 설정(SUPER) ── */
function SettingsBox() {
  const q = useApi<{ settings: Set_; job: string }>('/admin/grw/overview');
  const a = useAct();
  const su = tokenRoles().includes('SUPER');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [pts, setPts] = useState('');
  const [cap, setCap] = useState('');
  const s = q.data?.settings;
  const save = (body: Record<string, unknown>) => void a.run('s', () => put('/admin/grw/settings', { ...body, reason }), () => { setDays(''); setPts(''); setCap(''); q.reload(); });
  const SW: Array<[keyof Set_, string, string]> = [
    ['signupSteps', '가입 단계 수 세기', '가입 화면 1 ~ 5단계에 닿은 하루 수만(계정 · IP · 쿠키 없음) · 처리방침 확인 뒤'],
    ['firstSteps', '첫 거래 안내 카드', '새 회원 나의공간 첫 화면 · 본인 기록만(처음 켜짐)'],
    ['digest', '알림 하루 요약', '회원이 켜면 매일 08:00 한 통 · 메일 준비 전에는 사이트 알림만'],
    ['tierLegalOk', '여러 단계 보상 — 법무 확인 끝', '확인한 곳 · 날짜를 사유에 적음 · 끄면 보상도 꺼짐'],
    ['tierReward', '여러 단계 추천 보상', '법무 확인 끝 표시가 있어야 켜짐 · 현금화 안 됨'],
    ['fillHelper', '매물 충실도 안내', '본인 매물에 고칠 곳 안내만 · 노출 순위 · 소개비에 쓰지 않음(처음 켜짐)'],
  ];
  return (
    <div className="card" data-screen="SB-ADM-GRW-010" data-grw-settings={s ? 'loaded' : ''}>
      <Flash msg={a.msg} err={a.err} />
      {!su && <p className="muted">설정은 SUPER 만 바꿉니다. 지금 값만 보입니다.</p>}
      {s && (
        <>
          <table className="tbl"><thead><tr><th>기능</th><th>지금</th><th>설명</th><th /></tr></thead>
            <tbody>{SW.map(([k, label, desc]) => (
              <tr key={k} data-grw-switch={k} data-on={s[k] ? 'on' : 'off'}>
                <td><b>{label}</b></td><td>{s[k] ? <b>켜짐</b> : <span className="muted">꺼짐</span>}</td><td className="muted">{desc}</td>
                <td>{su && <button className="btn-sm" disabled={a.busy === 's' || reason.trim().length < 2} onClick={() => save({ [k]: !s[k] })} data-grw-toggle={k}>{s[k] ? '끄기' : '켜기'}</button>}</td>
              </tr>))}</tbody></table>
          <p>
            <label style={{ marginRight: 12 }}>첫 거래 안내 날 수(7 ~ 365){' '}
              <input type="number" min={7} max={365} value={days || String(s.firstStepsDays)} onChange={(e) => setDays(e.target.value)} style={{ width: 72 }} disabled={!su} /></label>
            <label style={{ marginRight: 12 }}>여러 단계 점수(2 · 3 · 4단계 · 쉼표){' '}
              <input value={pts || s.tierPoints} onChange={(e) => setPts(e.target.value)} size={12} disabled={!su} data-grw-points="" /></label>
            <label>한 달 상한(0 = 없음){' '}
              <input type="number" min={0} max={1000} value={cap} onChange={(e) => setCap(e.target.value)} style={{ width: 72 }} disabled={!su} /></label>
          </p>
          <p>
            <label>바꾸는 사유(2 ~ 200자 · 설정 바뀐 기록에 남음){' '}
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} size={40} disabled={!su} data-grw-reason="" /></label>
          </p>
          {su && <p><button className="btn-sm" disabled={a.busy === 's' || reason.trim().length < 2 || (!days && !pts && cap === '')}
            onClick={() => save({ ...(days ? { firstStepsDays: Number(days) } : {}), ...(pts ? { tierPoints: pts.trim() } : {}), ...(cap !== '' ? { tierMonthlyCap: Number(cap) } : {}) })} data-grw-save="">값 저장</button></p>}
          <p className="muted">{q.data?.job}</p>
        </>
      )}
    </div>
  );
}
