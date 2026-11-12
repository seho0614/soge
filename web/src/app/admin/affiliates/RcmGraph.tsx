import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/* ── v10.254 (docs/388) 운영 화면 추천 관계도 그림 ↔ 목록 ───────────────────────
 *   사용자 웹 RcmTree 와 같은 그리기(위 → 아래 상자 · 선 · 확대 · 축소 · 끌기 · 찾기 · 펴고 접기 · 모두 펴기).
 *   상자를 누르면 그 회원을 고름(onSelect) — 아래 칸에서 「이 회원 관계도」 · 「정산 내역」 · 펴기 / 접기.
 *   300명이 넘으면 목록으로 먼저. 계층 용어(하위 · 산하 · 직급)를 쓰지 않습니다.
 *   v10.258 (docs/390) 직접 추천한 분 상자 셋째 줄 — 고른 회원이 그분 덕분에 받은 보상(받음 nP · 인증 기다림 · 보상 없음). */
export interface GNode { k: number; p: number; gen: number; id: string; name: string; code: string | null; status: string; verified: boolean; joined: string; children: number; reward?: { state: 'GOT' | 'WAIT' | 'NONE'; points: number; at: string | null } | null }

const W = 140, H = 62, GX = 16, GY = 40;
const RW = (r: NonNullable<GNode['reward']>) => (r.state === 'GOT' ? `보상 ${r.points.toLocaleString('ko-KR')}P` : r.state === 'WAIT' ? '인증 기다림' : '보상 없음');

export function RcmGraph({ rootName, nodes, onSelect, listLabel }: {
  rootName: string; nodes: GNode[]; onSelect: (n: GNode) => void; listLabel: (n: GNode) => ReactNode;
}) {
  const kids = useMemo(() => { const m = new Map<number, GNode[]>(); for (const n of nodes) m.set(n.p, [...(m.get(n.p) ?? []), n]); return m; }, [nodes]);
  const byK = useMemo(() => new Map(nodes.map((n) => [n.k, n])), [nodes]);
  const [mode, setMode] = useState<'graph' | 'list'>(nodes.length > 300 ? 'list' : 'graph');
  const [open, setOpen] = useState<Set<number>>(() => new Set([0, ...nodes.filter((n) => n.gen <= 2 && n.children > 0).map((n) => n.k)]));
  const [q, setQ] = useState('');
  const [hit, setHit] = useState<number[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [view, setView] = useState({ x: 20, y: 20, s: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setMode(nodes.length > 300 ? 'list' : 'graph'); }, [nodes.length]);

  const layout = useMemo(() => {
    const pos = new Map<number, { x: number; y: number }>();
    let col = 0;
    const walk = (k: number, d: number): number => {
      const cs = open.has(k) ? kids.get(k) ?? [] : [];
      let x: number;
      if (!cs.length) { x = col * (W + GX); col += 1; } else { const xs = cs.map((c) => walk(c.k, d + 1)); x = (xs[0]! + xs[xs.length - 1]!) / 2; }
      pos.set(k, { x, y: d * (H + GY) });
      return x;
    };
    walk(0, 0);
    let maxY = 0; for (const v of pos.values()) maxY = Math.max(maxY, v.y);
    return { pos, w: Math.max(1, col) * (W + GX), h: maxY + H };
  }, [open, kids]);

  const toggle = (k: number) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const all = (on: boolean) => setOpen(on ? new Set([0, ...nodes.filter((n) => n.children > 0).map((n) => n.k)]) : new Set([0]));
  const fit = () => {
    const el = box.current; if (!el) return;
    setView({ x: 20, y: 20, s: Math.min(1, Math.max(0.2, Math.min((el.clientWidth - 40) / layout.w, (el.clientHeight - 40) / layout.h))) });
  };
  const find = () => {
    const t = q.trim(); if (!t) { setHit([]); return; }
    const hs = nodes.filter((n) => n.name.includes(t) || (n.code ?? '') === t.toUpperCase()).map((n) => n.k);
    setHit(hs); if (!hs.length) return;
    setOpen((o) => { const n = new Set(o); for (const h of hs) { let c = byK.get(h); while (c && c.p !== 0) { n.add(c.p); c = byK.get(c.p); } } n.add(0); return n; });
    setTimeout(() => {
      const el = box.current, p = layout.pos.get(hs[0]!); if (!el || !p) return;
      setView((v) => ({ ...v, x: el.clientWidth / 2 - (p.x + W / 2) * v.s, y: el.clientHeight / 3 - p.y * v.s }));
    }, 0);
  };
  const pick = (n: GNode) => { setSel(n.k); onSelect(n); };

  const branch = (pk: number): ReactNode => {
    const xs = kids.get(pk) ?? [];
    if (!xs.length) return null;
    return (
      <ul className="rcm-ul" style={{ listStyle: 'none', paddingLeft: 18, margin: '4px 0 0' }}>
        {xs.map((x) => (
          <li key={x.k} data-rcm-gen={x.gen} style={hit.includes(x.k) ? { background: '#fff3d6' } : undefined}>
            {x.children > 0
              ? <details open={open.has(x.k)} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; if (o !== open.has(x.k)) toggle(x.k); }}>
                  <summary>{listLabel(x)} <span className="dim">· 그분이 추천한 분 {x.children}명</span></summary>{open.has(x.k) && branch(x.k)}</details>
              : listLabel(x)}
          </li>
        ))}
      </ul>
    );
  };

  const lines: Array<[number, number, number, number]> = [];
  for (const [k, p] of layout.pos) { if (k === 0) continue; const n = byK.get(k), pp = n ? layout.pos.get(n.p) : null; if (pp) lines.push([pp.x + W / 2, pp.y + H, p.x + W / 2, p.y]); }

  return (
    <div data-rcm-graph={mode}>
      <div className="search-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button className={mode === 'graph' ? 'btn-sm' : 'btn-sm ghost'} onClick={() => setMode('graph')} data-rcm-mode="graph">그림</button>
        <button className={mode === 'list' ? 'btn-sm' : 'btn-sm ghost'} onClick={() => setMode('list')} data-rcm-mode="list">목록</button>
        <button className="btn-plain btn-sm" onClick={() => all(true)}>모두 펴기</button>
        <button className="btn-plain btn-sm" onClick={() => all(false)}>모두 접기</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') find(); }} placeholder="이름 · 추천 코드" aria-label="관계도에서 찾기" style={{ maxWidth: 180 }} />
        <button className="btn-plain btn-sm" onClick={find}>찾기</button>
        {q.trim() && <span className="dim" data-rcm-hits={hit.length}>{hit.length ? `${hit.length}명` : '없음'}</span>}
        {mode === 'graph' && <>
          <button className="btn-plain btn-sm" onClick={() => setView((v) => ({ ...v, s: Math.min(2, v.s * 1.25) }))} aria-label="크게">＋</button>
          <button className="btn-plain btn-sm" onClick={() => setView((v) => ({ ...v, s: Math.max(0.2, v.s / 1.25) }))} aria-label="작게">－</button>
          <button className="btn-plain btn-sm" onClick={fit}>화면에 맞춤</button>
          <span className="dim">상자를 누르면 그 회원을 고름 · 빈 곳을 끌어 옮김 · Ctrl + 휠로 크기</span>
        </>}
      </div>
      {mode === 'list' ? <div className="rcm-tree">{branch(0)}</div> : (
        <div ref={box} style={{ position: 'relative', height: 480, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg, #f7f7f9)', overflow: 'hidden', touchAction: 'none', cursor: 'grab' }}
             onPointerDown={(e) => { if ((e.target as Element).closest('[data-rcm-node]')) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); }}
             onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); }}
             onPointerUp={() => { drag.current = null; }}
             onWheel={(e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setView((v) => ({ ...v, s: Math.min(2, Math.max(0.2, v.s * (e.deltaY < 0 ? 1.1 : 0.9))) })); }}>
          <svg width="100%" height="100%" role="img" aria-label="추천 관계도 그림">
            <g transform={`translate(${view.x},${view.y}) scale(${view.s})`}>
              {lines.map(([x1, y1, x2, y2], i) => { const my = (y1 + y2) / 2; return <path key={i} d={`M${x1},${y1} V${my} H${x2} V${y2}`} fill="none" stroke="var(--muted, #888)" strokeOpacity={0.6} />; })}
              {[...layout.pos].map(([k, p]) => {
                const n = k === 0 ? null : byK.get(k)!;
                const closed = !!n && n.children > 0 && !open.has(k);
                const stroke = hit.includes(k) ? 'var(--accent)' : sel === k ? 'var(--danger)' : 'var(--line)';
                return (
                  <g key={k} transform={`translate(${p.x},${p.y})`} {...(n ? { 'data-rcm-node': n.id } : {})} style={{ cursor: n ? 'pointer' : 'default' }}
                     onClick={() => { if (n) pick(n); }}>
                    <rect width={W} height={H} rx={8} fill={k === 0 ? 'var(--accent)' : '#fff'} stroke={stroke} strokeWidth={hit.includes(k) || sel === k ? 2.5 : 1.2} />
                    <text x={W / 2} y={20} textAnchor="middle" fontSize={13} fontWeight={700} fill={k === 0 ? '#fff' : 'currentColor'}>{k === 0 ? rootName : n!.name}</text>
                    <text x={W / 2} y={37} textAnchor="middle" fontSize={11} fill={k === 0 ? '#fff' : 'var(--muted, #777)'}>{k === 0 ? '고른 회원' : `${n!.joined}${n!.verified ? ' · 인증' : ''}${n!.status !== 'ACTIVE' ? ` · ${n!.status}` : ''}`}</text>
                    {n?.reward && <text x={W / 2} y={53} textAnchor="middle" fontSize={11} fontWeight={700} fill={n.reward.state === 'GOT' ? 'var(--ok)' : n.reward.state === 'WAIT' ? 'var(--sgb-or-text)' : 'var(--muted, #777)'} data-rcm-reward={n.reward.state}>{RW(n.reward)}</text>}
                    {n && n.children > 0 && (
                      <text x={W - 8} y={14} textAnchor="end" fontSize={12} fontWeight={700} fill="var(--accent)" onClick={(e) => { e.stopPropagation(); toggle(k); }} data-rcm-toggle={n.id}>{closed ? `+${n.children}` : '−'}</text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}
      {sel !== null && byK.get(sel) && byK.get(sel)!.children > 0 && (
        <p className="hint"><button className="btn-plain btn-sm" onClick={() => toggle(sel)}>{open.has(sel) ? '고른 회원 접기' : '고른 회원 펴기'}</button></p>
      )}
    </div>
  );
}
