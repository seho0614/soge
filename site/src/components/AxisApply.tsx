'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * SB-PTC-CTR-100 · SB-PTC-LST-010 — 안심소개 축별 입점 신청 · 상태 (서버 D018 · /api/v1/partner/axes)
 * 한 업체가 여러 축에 입점할 수 있고 축마다 따로 승인합니다. 반려된 축만 다시 낼 수 있습니다.
 * v10.38 (D096 · P2P) — 계정 기준. 사업자 정보가 없는 본인인증 개인도 신청합니다(「내야 할 자격」의 사업자 인증 → 본인인증).
 */
/* v10.31 (W5 · 10/10 시안 기준 SB-PTC-CTR-100) — 「내야 할 자격」 · 「본사 확인」 문구를 시안대로.
 *   생활 · 금융 상담의 등록 · 허가 업종에는 시안 목록에 없던 카드 · 금융 · 법률 · 세무를 더했습니다(서버 규제 업종 — 빠뜨리면 자격 없이 내도 되는 것처럼 읽힘 · 결정 기록). */
/* v10.101 (2-5b) — 축 이름 · 자격 · 본사 확인 글은 사전(join.axisApply.axes.<축>)에 */
const AXES = ['EQUIP', 'RE', 'SOLAR', 'CONSULT'] as const;
/* 상태 글은 사전(join.axisApply.state.<상태>) — 없는 상태는 서버 값 그대로 */
interface Ax { axis: string; state: string; source: string; reason?: string | null }

export function AxisApply() {
  const t = useTranslations('join.axisApply');
  const stateText = (s: string) => { const k = `state.${s}` as never; return t.has(k) ? t(k) : s; };
  const [mine, setMine] = useState<Ax[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch('/api/v1/partner/axes');
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErr(j?.message ?? t('loadFail')); setMine([]); return; }
    setMine(j as Ax[]);
  }
  useEffect(() => { void load(); }, []);

  async function apply() {
    if (!pick.length) { setErr(t('pickOne')); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch('/api/v1/partner/axes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ axes: pick }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message ?? t('failed'));
      setMine(j as Ax[]); setPick([]); setMsg(t('applied'));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const byAxis = new Map((mine ?? []).map((a) => [a.axis, a]));
  return (
    <section className="card ptc-box" data-axis-apply="1">
      <h2>{t('title')}</h2>
      <table className="tbl">
        <thead><tr><th>{t('th.axis')}</th><th>{t('th.need')}</th><th>{t('th.check')}</th><th>{t('th.state')}</th><th>{t('th.apply')}</th></tr></thead>
        <tbody>
          {AXES.map((k) => {
            const name = t(`axes.${k}.name`), need = t(`axes.${k}.need`), check = t(`axes.${k}.check`);
            const a = byAxis.get(k);
            const can = !a || a.state === 'REJECTED';
            return (
              <tr key={k} data-axis={k} data-axis-state={a?.state ?? 'NONE'}>
                <td><b>{name}</b></td>
                <td>{need}</td>
                <td>{check}</td>
                <td>{a ? stateText(a.state) : t('none')}{a?.reason ? <span className="hint"> — {a.reason}</span> : null}</td>
                <td>
                  <input type="checkbox" name={`axis-${k}`} aria-label={t('applyAria', { name })} disabled={!can}
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
        {busy ? t('working') : t('submit')}
      </button>
    </section>
  );
}
