import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, ymdhm } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';

/* ── SB-ADM-SEG-010 성향 학습 ────────────────────────────────────── */
interface SegC { accountId: string; currentCode?: string; toCode: string; clicksFrom: number; clicksTo: number }

interface SegRes { enabled: boolean; minClicks: number; ratio: number; items: SegC[]; noConsent: number; thrash: number }

interface SegLog { id: string; fromCode: string | null; fromName: string | null; toCode: string; toName: string | null; clicksFrom: number; clicksTo: number; appliedAt: string; revertedAt: string | null }

interface SegPrev {
  enabled: boolean; minClicks: number; ratio: number; moved: number; held: number; noConsent: number;
  items: { member: string; ref: string; currentCode: string | null; currentName: string | null; toCode: string; toName: string | null; clicksFrom: number; clicksTo: number; verdict: string }[];
}

/* SB-ADM-SEG-010 성향 학습 · SB-ADM-SEG-020 옮길 대상 미리보기
 * v10.31 (10/10 시안 기준) — 시안: 지표 4칸 → 안내 → 「옮긴 기록」 표 → 안내 2 → 「안전장치」 표 → 「학습 실행 · 대상 보기」.
 * 「대상 보기」는 학습 실행 전 미리보기(옮김 · 보류 판정 · 이름 첫 글자만 · GET /admin/segments/preview)를 엽니다. */
/* v10.32 — 미리보기에 자기 주소(#/ai-ops/segments-preview)가 생겼습니다. onPreview 가 오면 그 주소로 갑니다 */
export function SegmentLearn({ onPreview }: { onPreview?: () => void } = {}) {
  const r = useApi<SegRes>('/admin/segments/candidates');
  const log = useApi<SegLog[]>('/admin/segments/log');
  const [preview, setPreview] = useState(false);
  const a = useAct();
  const learn = () => {
    if (!confirm('행동으로 세그먼트를 옮깁니다. 진행하시겠습니까?')) return;
    void a.run('learn', () => api<{ applied: number; note: string }>('/admin/segments/learn', { method: 'POST' }), () => { r.reload(); log.reload(); },
      (x) => x?.note ?? `${x?.applied ?? 0}명을 옮겼습니다.`);
  };
  if (preview) return <SegmentPreview onBack={() => setPreview(false)} />;
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const seg = (c: string | null, nm: string | null) => (c ? `${c}${nm ? ` ${nm.split(' ')[0]}` : ''}` : '—');
  return (
    <>
      <h2>성향 학습</h2>
      <p className="lead">행동으로 세그먼트를 고칩니다.</p>
      <div className="kpi4">
        <div><b className={d.enabled ? 'good' : ''}>{d.enabled ? 'on' : 'off'}</b><span>학습</span></div>
        <div><b>{d.minClicks}</b><span>최소 클릭</span></div>
        <div><b>{d.ratio}배</b><span>차이 기준</span></div>
        <div><b className={d.thrash ? 'bad' : 'good'}>{d.thrash}</b><span>왔다갔다</span></div>
      </div>
      {d.noConsent > 0 && <p className="card warn"><b>동의 없이 바뀐 건 {d.noConsent}건</b> — 0 이어야 합니다. 즉시 확인하십시오.</p>}
      <div className="ad-nt info"><b>질문은 가입할 때 한 번 답한 것입니다.</b> 사업은 바뀌므로 행동이 더 최근 사실입니다.</div>
      <Flash msg={a.msg} err={a.err} />

      <h3 className="ad-s2">옮긴 기록 <em>{(log.data ?? []).length}</em></h3>
      <div className="ad-tw"><table className="tbl" data-seg-log>
        <thead><tr><th>전</th><th>후</th><th className="num-cell">원래 클릭</th><th className="num-cell">새 클릭</th><th>일시</th></tr></thead>
        <tbody>
          {(log.data ?? []).length === 0 && <tr><td colSpan={5} className="muted">아직 옮긴 회원이 없습니다.</td></tr>}
          {(log.data ?? []).map((x) => (
            <tr key={x.id}><td>{seg(x.fromCode, x.fromName)}</td><td><b>{seg(x.toCode, x.toName)}</b></td>
              <td className="num-cell">{x.clicksFrom}</td><td className="num-cell">{x.clicksTo}</td>
              <td>{ymdhm(x.appliedAt)}{x.revertedAt && <span className="ad-bg" style={{ marginLeft: 6 }}>되돌림</span>}</td></tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt warn"><b>소재 하나가 여러 세그먼트를 겨냥하면</b> 그런 클릭은 어느 쪽이 끌었는지 몰라 신호로 쓰지 않습니다 — 애매하면 안 옮깁니다.</div>
      <div className="ad-nt info"><b>개인정보를 늘리지 않았습니다.</b> 이미 있는 광고 집계만 씁니다. 광고주는 여전히 집계만 받습니다.</div>

      <h3 className="ad-s2">안전장치</h3>
      <div className="ad-tw"><table className="tbl" data-seg-safety>
        <thead><tr><th>막는 것</th><th>왜</th></tr></thead>
        <tbody>
          <tr><td><b>맞춤형 광고 동의가 없는 회원</b></td><td>성향 자체를 쓰지 않습니다(약관 ADPERSONAL · v10.115) — 동의 없이 바뀐 건 {d.noConsent}건 · 동의한 뒤의 클릭만 셉니다</td></tr>
          <tr><td><b>1~{Math.max(d.minClicks - 1, 1)}회 클릭</b></td><td>지나가다 누른 것일 수 있습니다(최소 {d.minClicks}회)</td></tr>
          <tr><td><b>왔다갔다</b></td><td>기준이 느슨한 것입니다 — 지금 {d.thrash}건</td></tr>
          <tr><td><b>출처 표시</b></td><td>BEHAVIOR — 질문이 아닌 행동으로 바뀜</td></tr>
        </tbody>
      </table></div>
      <div className="ad-dact">
        <button className="btn-ok" disabled={a.busy === 'learn' || !d.enabled} onClick={learn}>학습 실행</button>
        <button className="btn-plain" onClick={() => (onPreview ? onPreview() : setPreview(true))} data-seg-preview>대상 보기</button>
        {!d.enabled && <span className="muted">학습이 꺼져 있습니다 (segment.learn.enabled)</span>}
      </div>
    </>
  );
}

/* SB-ADM-SEG-020 옮길 대상 미리보기 — 시안 「옮김 · 보류 · 동의 안 함 제외 · 최소 클릭」 4칸 + 회원별 판정 표 */
/* v10.32 — bare: 자기 주소(#/ai-ops/segments-preview)로 열 때는 제목 · 설명을 위 제목 줄(SUB_PAGE)이 그립니다 */
export function SegmentPreview({ onBack, bare }: { onBack: () => void; bare?: boolean }) {
  const r = useApi<SegPrev>('/admin/segments/preview');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;
  const why = (v: string) => (v === 'MOVE' ? '옮김' : v === 'HOLD_CLICKS' ? `보류 — 클릭 ${d.minClicks}회 미만` : `보류 — 차이 ${d.ratio}배 미만`);
  return (
    <section data-seg-preview-view>
      {!bare && <>
        <h2>옮길 대상 미리보기 <span className="ad-sid">SB-ADM-SEG-020</span></h2>
        <p className="lead">학습을 실행하면 옮겨질 회원입니다. 실행 전에 확인합니다.</p>
      </>}
      <div className="kpi4">
        <div><b>{d.moved}</b><span>옮김</span></div>
        <div><b>{d.held}</b><span>보류</span></div>
        <div><b className={d.noConsent > 0 ? '' : 'good'}>{d.noConsent}</b><span>동의 없이 바뀐 건(0 이어야 함)</span></div>
        <div><b>{d.minClicks}</b><span>최소 클릭</span></div>
      </div>
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>회원</th><th>지금</th><th>옮길 곳</th><th className="num-cell">원래 쪽 클릭</th><th className="num-cell">새 쪽 클릭</th><th>판정</th></tr></thead>
        <tbody>
          {d.items.length === 0 && <tr><td colSpan={6} className="muted">옮길 대상도 보류도 없습니다 — 동의한 회원 중 다른 세그먼트를 누른 행동이 없습니다.</td></tr>}
          {d.items.map((x) => (
            <tr key={x.ref} data-verdict={x.verdict}>
              <td>{x.member}</td><td>{x.currentCode ?? '—'} {x.currentName?.split(' ')[0]}</td><td>{x.toCode} {x.toName?.split(' ')[0]}</td>
              <td className="num-cell">{x.clicksFrom}</td><td className="num-cell">{x.clicksTo}</td>
              <td><span className={`ad-bg ${x.verdict === 'MOVE' ? 'ok' : 'wait'}`}>{why(x.verdict)}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt info"><b>이름은 첫 글자만 보입니다.</b> 광고주는 이 목록을 받지 않습니다 — 여전히 집계만 받습니다.</div>
      <div className="ad-nt warn"><b>여러 세그먼트를 겨냥한 소재의 클릭은 세지 않습니다.</b> 어느 쪽이 끌었는지 몰라 신호로 쓰지 않습니다.</div>
      <div className="ad-dact"><button className="btn-plain" onClick={onBack}>← 성향 학습</button></div>
    </section>
  );
}
