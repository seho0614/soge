import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { ymd } from '../../lib/act';

interface Item { id: string; title: string | null; sub: string | null; at: string | null }
interface Section { key: string; label: string; tab: string; items: Item[] }

/**
 * v10.289 (docs/413) 운영 화면 전체 찾기 — 메뉴 줄 오른쪽 칸
 *
 * 회원 · 소개몰 주문 · 판매자 · 공지 · 매물 · 거래를 묶음마다 5건(역할마다 볼 수 있는 묶음만 · 이름 · 이메일은 가림).
 * 줄을 누르면 그 운영 화면 탭으로 가고, 번호는 복사해 그 화면에서 찾습니다. 찾을 때마다 감사 ADMIN_SEARCH.
 */
export function AdminSearch({ onGo, canGo }: { onGo: (tab: string) => void; canGo: (tab: string) => boolean }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Section[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes(null); setErr(null); return; }
    const h = setTimeout(() => {
      api<{ sections: Section[] }>(`/admin/search?q=${encodeURIComponent(t)}`)
        .then((r) => { setRes(r.sections); setErr(null); setOpen(true); })
        .catch((e) => { setErr(String((e as Error).message ?? e)); setRes(null); });
    }, 350);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const total = (res ?? []).reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="ad-search" ref={box} style={{ position: 'relative' }} data-admin-search>
      <input type="search" value={q} placeholder="전체 찾기" aria-label="전체 찾기"
             onChange={(e) => setQ(e.target.value)} onFocus={() => res && setOpen(true)}
             onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
             style={{ width: 180, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line, #d0d5dd)' }} data-admin-search-input />
      {open && (res || err) && (
        <div className="card pad" role="listbox" data-admin-search-result={total}
             style={{ position: 'absolute', right: 0, top: '110%', width: 420, maxHeight: '70vh', overflow: 'auto', zIndex: 50, textAlign: 'left', color: 'var(--ink, #111)', background: 'var(--bg, #fff)' }}>
          {err && <p className="muted">{err}</p>}
          {res && total === 0 && <p className="muted">찾은 것이 없습니다.</p>}
          {(res ?? []).filter((s) => s.items.length).map((s) => (
            <div key={s.key} data-admin-search-section={s.key}>
              <b>{s.label}</b>
              <ul style={{ listStyle: 'none', margin: '4px 0 10px', padding: 0 }}>
                {s.items.map((it) => (
                  <li key={it.id}>
                    <button className="linkbtn" disabled={!canGo(s.tab)} title={it.id}
                            onClick={() => { void navigator.clipboard?.writeText(it.id).catch(() => undefined); setOpen(false); onGo(s.tab); }}
                            data-admin-search-item={s.key}>
                      {it.title ?? '—'}
                    </button>
                    <span className="dim"> {it.sub ?? ''}{it.at ? ` · ${ymd(it.at)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="hint">누르면 그 화면으로 가고 번호가 복사됩니다. 이름 · 이메일은 가려서 보입니다.</p>
        </div>
      )}
    </div>
  );
}
