'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SB-PTC-CTR-230 서비스(활동) 지역 — 켜고 끄기 · 더하기 · 저장 (v10.27 · G-192)
 *
 * 전에는 「최소 한 곳은 켜셔야 합니다」라고만 하고 켤 수단이 없었습니다(API 는 있었음 — POST /partner/regions).
 * 시안(scPtnRegion)처럼 「영업 중 N곳」 · 「꺼둔 지역 N곳」을 칩으로 보이고, 칩을 누르면 켜고 끕니다.
 * 시 · 군 · 구 단위까지만 받습니다 — 동 · 호수는 특정 개인을 가리킬 수 있어 넣지 않습니다.
 * 저장은 「영업 중」 목록 전체를 한 번에 보냅니다(서버가 바꿔 끼움). 꺼둔 지역은 저장하지 않으면 사라집니다.
 */
const SIDO = ['서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
interface Region { sido: string; sigungu: string }
const key = (r: Region) => `${r.sido} ${r.sigungu}`;

export function RegionEditor({ initial }: { initial: Region[] }) {
  const router = useRouter();
  const [on, setOn] = useState<Region[]>(initial);
  const [off, setOff] = useState<Region[]>([]);
  const [sido, setSido] = useState('서울');
  const [sigungu, setSigungu] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<[ 'ok' | 'err', string ] | null>(null);
  const dirty = key2(on) !== key2(initial);

  function toggle(r: Region, toOn: boolean) {
    setMsg(null);
    if (toOn) { setOff(off.filter((x) => key(x) !== key(r))); setOn([...on, r]); }
    else { setOn(on.filter((x) => key(x) !== key(r))); setOff([...off, r]); }
  }
  function add() {
    const s = sigungu.trim();
    if (!s) { setMsg(['err', '시 · 군 · 구를 적어 주십시오 — 예: 금천구']); return; }
    if (s.length > 20 || /\d|동$|호$/.test(s)) { setMsg(['err', '시 · 군 · 구까지만 적어 주십시오(동 · 호수는 넣지 않습니다).']); return; }
    const r = { sido, sigungu: s };
    if (on.some((x) => key(x) === key(r))) { setMsg(['err', `${key(r)}은(는) 이미 켜져 있습니다.`]); return; }
    setOff(off.filter((x) => key(x) !== key(r))); setOn([...on, r]); setSigungu(''); setMsg(null);
  }
  async function save() {
    if (!on.length) { setMsg(['err', '최소 한 곳은 켜셔야 합니다. 켜진 지역이 없으면 리드가 오지 않습니다.']); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/v1/partner/regions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regions: on }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? String(r.status));
      setMsg(['ok', `저장했습니다 — ${on.length}개 지역에서 리드를 받습니다.`]);
      router.refresh();
    } catch (e) {
      setMsg(['err', e instanceof Error && e.message ? e.message : '저장하지 못했습니다. 잠시 후 다시 시도해 주십시오.']);
    } finally { setBusy(false); }
  }

  return (
    <div data-region-editor>
      {/* v10.29 — 시안 scPtnRegion 모양(.s2 소제목 · .chips 칩 · .fset 입력 묶음) */}
      <h2 className="pt-s2">영업 중 {on.length}곳</h2>
      {on.length === 0
        ? <p className="pt-ls">켠 지역이 없습니다.</p>
        : <div className="pt-chips region-chips">{on.map((r) => (
            <button key={key(r)} type="button" className="pt-chip on" data-region-on={key(r)}
                    title="누르면 끕니다" onClick={() => toggle(r, false)}>{key(r)} ✕</button>))}</div>}
      <h2 className="pt-s2">꺼둔 지역 {off.length}곳</h2>
      {off.length === 0
        ? <p className="pt-ls">끈 지역이 없습니다. 위의 지역을 누르면 여기로 옵니다.</p>
        : <div className="pt-chips region-chips">{off.map((r) => (
            <button key={key(r)} type="button" className="pt-chip" data-region-off={key(r)}
                    title="누르면 다시 켭니다" onClick={() => toggle(r, true)}>{key(r)} ＋</button>))}</div>}

      <div className="pt-fset" style={{ marginTop: 14 }}>
        <h3>지역 더하기</h3>
        <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <select aria-label="시 · 도" value={sido} onChange={(e) => setSido(e.target.value)}>
            {SIDO.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input aria-label="시 · 군 · 구" placeholder="시 · 군 · 구 (예: 금천구)" value={sigungu} maxLength={20}
                 onChange={(e) => setSigungu(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" className="pt-bo" onClick={add} data-region-add>켜기</button>
        </div>
      </div>

      <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button type="button" className="pt-bp" disabled={busy || !dirty} onClick={save} data-region-save>
          {busy ? '저장하는 중…' : '저장'}
        </button>
        {dirty && !busy && <span className="pt-ls">바꾼 내용이 아직 저장되지 않았습니다.</span>}
      </div>
      {msg && <p className={msg[0] === 'ok' ? 'pt-nt ok' : 'pt-nt warn'} role={msg[0] === 'ok' ? 'status' : 'alert'} data-region-msg={msg[0]}>{msg[1]}</p>}
    </div>
  );
}
function key2(list: Region[]) { return list.map(key).sort().join('|'); }
