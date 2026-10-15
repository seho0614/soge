'use client';

import { useEffect, useState } from 'react';

/**
 * SB-PTC-CTR-100 · SB-PTC-LST-010 — 안심소개 축별 입점 신청 · 상태 (서버 D018 · /api/v1/partner/axes)
 * 한 업체가 여러 축에 입점할 수 있고 축마다 따로 승인합니다. 반려된 축만 다시 낼 수 있습니다.
 * v10.38 (D096 · P2P) — 계정 기준. 사업자 정보가 없는 본인인증 개인도 신청합니다(「내야 할 자격」의 사업자 인증 → 본인인증).
 */
/* v10.31 (W5 · 10/10 시안 기준 SB-PTC-CTR-100) — 「내야 할 자격」 · 「본사 확인」 문구를 시안대로.
 *   생활 · 금융 상담의 등록 · 허가 업종에는 시안 목록에 없던 카드 · 금융 · 법률 · 세무를 더했습니다(서버 규제 업종 — 빠뜨리면 자격 없이 내도 되는 것처럼 읽힘 · 결정 기록). */
const AXES: Array<[string, string, string, string]> = [
  ['EQUIP', '기계 · 설비 · 시설', '본인인증 (사업자는 사업자 인증)', '입점 승인 · 매물 검수'],
  ['RE', '부동산', '개업공인중개사 인증 (국토부 자료 대조 + 공제증서)', '입점 승인 · 중개사 인증 심사'],
  ['SOLAR', '태양광', '본인인증 (발전사업 자격 필요 여부 확인 중)', '입점 승인 · 매물 검수'],
  ['CONSULT', '생활 · 금융 상담', '업종별 자격 — 보험 · 카드 · 금융 · 의료 · 법률 · 세무 · 이사짐 · 인테리어 · 건설 · 자동차 · 여행 · 교육 · 물류 · 통신은 등록 · 허가증, 청소 · 웨딩 · 행사 · 렌탈 · 중고차 · 광고 · 디자인 · IT · 제조 · 유통은 본인인증(사업자는 사업자 인증)', '입점 승인 · 자격 심사 · 서비스 검수'],
];
const STATE: Record<string, string> = { PENDING: '심사 중', APPROVED: '승인', REJECTED: '반려', REVOKED: '해지' };
interface Ax { axis: string; state: string; source: string; reason?: string | null }

export function AxisApply() {
  const [mine, setMine] = useState<Ax[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch('/api/v1/partner/axes');
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErr(j?.message ?? '입점 상태를 불러오지 못했습니다.'); setMine([]); return; }
    setMine(j as Ax[]);
  }
  useEffect(() => { void load(); }, []);

  async function apply() {
    if (!pick.length) { setErr('입점할 축을 하나 이상 고르십시오.'); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/v1/partner/axes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes: pick }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message ?? '신청하지 못했습니다.');
      setMine(j as Ax[]); setPick([]); setMsg('신청했습니다. 본사 심사 뒤 알림으로 알려 드립니다.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const byAxis = new Map((mine ?? []).map((a) => [a.axis, a]));
  return (
    <section className="card ptc-box" data-axis-apply="1">
      <h2>입점할 축 — 여러 개 고를 수 있고 축마다 따로 승인합니다</h2>
      <table className="tbl">
        <thead><tr><th>축</th><th>내야 할 자격</th><th>본사 확인</th><th>상태</th><th>신청</th></tr></thead>
        <tbody>
          {AXES.map(([k, name, need, check]) => {
            const a = byAxis.get(k);
            const can = !a || a.state === 'REJECTED';
            return (
              <tr key={k} data-axis={k} data-axis-state={a?.state ?? 'NONE'}>
                <td><b>{name}</b></td>
                <td>{need}</td>
                <td>{check}</td>
                <td>{a ? STATE[a.state] ?? a.state : '미신청'}{a?.reason ? <span className="hint"> — {a.reason}</span> : null}</td>
                <td>
                  <input type="checkbox" name={`axis-${k}`} aria-label={`${name} 신청`} disabled={!can}
                         checked={pick.includes(k)}
                         onChange={(e) => setPick(e.target.checked ? [...pick, k] : pick.filter((x) => x !== k))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {err ? <p className="form-error" role="alert">{err}</p> : null}
      {msg ? <p className="form-ok" role="status">{msg}</p> : null}
      <button type="button" className="btn-primary" disabled={busy || mine === null} onClick={() => void apply()}>
        {busy ? '신청하는 중…' : '고른 축 입점 신청'}
      </button>
    </section>
  );
}
