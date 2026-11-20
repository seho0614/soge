/**
 * v10.457 — 운영 화면 왼쪽 메뉴 트리(대표 11/20 「관리자 화면 왼쪽 메뉴 트리 생성」 · decisions/design-standard).
 *   상위 묶음 이름표(NAV_SECTIONS) → 그룹(GROUPS) → 하위 묶음 이름표(GROUP_SECTIONS · 회계) → 화면(탭).
 *   상단바 그룹 단추 · 본문 위 탭 줄(.ad-snb)을 이것 하나로 바꿈. 주소(#/탭) · 권한(보이는 탭만) · 화면은 그대로.
 *   화면 시험이 찾는 표식은 그대로 둠: 그룹 단추 data-group · data-tabs="|탭|탭|" · 화면 단추 data-tab · 이름표 data-nav-section · data-section.
 *   즐겨찾기 · 최근 본 화면은 계정마다 이 브라우저에만(localStorage · 못 읽으면 없이 동작) — 같은 화면 단추는 data-tab-link(시험의 data-tab 과 겹치지 않게).
 */
import { useEffect, useMemo, useState } from 'react';
import { navSectionsOf, sectionsOf, type MenuGroup, type Tab } from '../../lib/adminMenu';

type Props = {
  groups: MenuGroup[];            // 보이는 탭만 남긴 그룹(빈 그룹 뺌)
  tab: Tab;                       // 지금 화면
  navKey: string;                 // 켜 둘 그룹(하위 화면이 다른 그룹이면 그 그룹 · SUB_GROUP)
  label: (t: Tab) => string;
  go: (t: Tab) => void;
  who: string;                    // 저장 열쇠(계정마다)
  drawer: boolean;                // 좁은 화면 서랍이 열렸는지
  onClose: () => void;            // 서랍 닫기(화면을 고르면 닫힘)
  folded: boolean;                // 넓은 화면에서 트리를 접었는지
  onFold: (v: boolean) => void;
};

const RECENT_MAX = 5;
function load<T>(key: string, dflt: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : dflt; } catch { return dflt; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장이 막힌 브라우저 — 이번 창에서만 */ }
}

export function AdminTree({ groups, tab, navKey, label, go, who, drawer, onClose, folded, onFold }: Props) {
  const K = (s: string) => `sgb.admTree.${s}.${who || 'anon'}`;
  const [q, setQ] = useState('');
  const [shutSecs, setShutSecs] = useState<string[]>(() => load(K('shutSecs'), []));       // 접은 상위 묶음(처음엔 모두 펼침)
  const [openGroups, setOpenGroups] = useState<string[]>(() => load(K('openGroups'), []));  // 펼친 그룹(지금 그룹은 늘 펼침)
  const [favs, setFavs] = useState<Tab[]>(() => load(K('favs'), []));
  const [recent, setRecent] = useState<Tab[]>(() => load(K('recent'), []));

  const allTabs = useMemo(() => groups.flatMap((g) => g.tabs), [groups]);
  const can = (t: Tab) => allTabs.includes(t);

  /* 지금 그룹은 펼침 · 최근 본 화면 맨 앞에 */
  useEffect(() => {
    setOpenGroups((o) => (o.includes(navKey) ? o : [...o, navKey]));
    setRecent((r) => { const n = [tab, ...r.filter((x) => x !== tab)].slice(0, RECENT_MAX); save(K('recent'), n); return n; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, navKey]);
  useEffect(() => { save(K('openGroups'), openGroups); }, [openGroups]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { save(K('shutSecs'), shutSecs); }, [shutSecs]);         // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (t: Tab) => { go(t); onClose(); };
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const star = (t: Tab) => setFavs((f) => { const n = toggle(f, t); save(K('favs'), n); return n; });
  const groupLabel = (t: Tab) => groups.find((g) => g.tabs.includes(t))?.label ?? '';

  /* 메뉴 찾기 — 화면 이름 · 그룹 이름에 글자가 들면(띄어쓰기 무시) */
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const hits = q.trim() ? allTabs.filter((t) => norm(label(t) + groupLabel(t)).includes(norm(q))) : [];

  const link = (t: Tab, key: string) => (
    <li key={key} className="ad-tr-li">
      <button className={t === tab ? 'ad-tr-leaf on' : 'ad-tr-leaf'} data-tab-link={t} aria-current={t === tab ? 'page' : undefined}
              onClick={() => pick(t)}>{label(t)} <small>{groupLabel(t)}</small></button>
    </li>
  );

  return (
    <aside className={`ad-tree${drawer ? ' open' : ''}${folded ? ' folded' : ''}`} aria-label="운영 메뉴" data-admin-tree="">
      <div className="ad-tr-top">
        <input type="search" className="ad-tr-q" placeholder="메뉴 찾기 (예: 전표)" value={q} aria-label="메뉴 찾기"
               data-tree-search="" onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { pick(hits[0]); setQ(''); } if (e.key === 'Escape') setQ(''); }} />
        <button className="ad-tr-fold" title="메뉴 접기" aria-label="메뉴 접기" data-tree-fold="" onClick={() => { onFold(true); onClose(); }}>«</button>
      </div>

      {q.trim() ? (
        <ul className="ad-tr-flat" data-tree-hits={hits.length}>
          {hits.length ? hits.map((t) => link(t, `h-${t}`)) : <li className="ad-tr-none">맞는 메뉴가 없습니다.</li>}
        </ul>
      ) : (
        <>
          {favs.filter(can).length > 0 && (
            <div className="ad-tr-box" data-tree-favs="">
              <div className="ad-tr-cap">★ 즐겨찾기</div>
              <ul className="ad-tr-flat">{favs.filter(can).map((t) => link(t, `f-${t}`))}</ul>
            </div>
          )}
          {recent.filter(can).length > 1 && (
            <div className="ad-tr-box" data-tree-recent="">
              <div className="ad-tr-cap">최근 본 화면</div>
              <ul className="ad-tr-flat">{recent.filter(can).slice(0, RECENT_MAX).map((t) => link(t, `r-${t}`))}</ul>
            </div>
          )}

          <nav className="ad-tr-nav" aria-label="운영 메뉴 트리">
            {navSectionsOf(groups).map((s) => {
              const shut = shutSecs.includes(s.label);
              return (
                <div key={s.label} className="ad-tr-sec" data-nav-section={s.label}>
                  <button className="ad-tr-sech" aria-expanded={!shut} onClick={() => setShutSecs((x) => toggle(x, s.label))}>
                    <span className={shut ? 'chev' : 'chev open'} aria-hidden="true">›</span>{s.label}
                  </button>
                  {!shut && s.groups.map((g) => {
                    const on = g.key === navKey;
                    const opened = on || openGroups.includes(g.key);
                    const one = g.tabs.length === 1;
                    return (
                      <div key={g.key} className={`ad-tr-g${on ? ' on' : ''}`}>
                        <div className="ad-tr-gh">
                          {!one && (
                            <button className="ad-tr-car" aria-label={`${g.label} ${opened ? '접기' : '펼치기'}`} aria-expanded={opened} data-tree-toggle={g.key}
                                    onClick={() => setOpenGroups((o) => (on ? o : toggle(o, g.key)))}><span className={opened ? 'chev open' : 'chev'} aria-hidden="true">›</span></button>
                          )}
                          <button className={on ? 'ad-tr-gb on' : 'ad-tr-gb'} data-group={g.key}
                                  data-tabs={`|${g.tabs.map(label).join('|')}|`} aria-current={on && one ? 'page' : undefined}
                                  title={g.tabs.map(label).join(' · ')}
                                  onClick={() => { setOpenGroups((o) => (o.includes(g.key) ? o : [...o, g.key])); if (one) pick(g.tabs[0]!); else go(on && g.tabs.includes(tab) ? tab : g.tabs[0]!); }}>
                            {g.label}{!one && <small>{g.tabs.length}</small>}
                          </button>
                        </div>
                        {!one && opened && (
                          <div className="ad-tr-leaves" role="group" aria-label={`${g.label} 화면`}>
                            {sectionsOf(g.key, g.tabs).map((ss) => (
                              <div key={ss.label || 'all'} className="ad-tr-ss" data-section={ss.label || undefined}>
                                {ss.label && <div className="ad-tr-ssl">{ss.label}</div>}
                                <ul>
                                  {ss.tabs.map((t) => (
                                    <li key={t} className="ad-tr-li">
                                      <button className={t === tab ? 'ad-tr-leaf on' : 'ad-tr-leaf'} data-tab={t} role="tab"
                                              aria-selected={t === tab} aria-current={t === tab ? 'page' : undefined} onClick={() => pick(t)}>{label(t)}</button>
                                      <button className={favs.includes(t) ? 'ad-tr-star on' : 'ad-tr-star'} data-fav={t}
                                              aria-label={favs.includes(t) ? `${label(t)} 즐겨찾기 빼기` : `${label(t)} 즐겨찾기`}
                                              aria-pressed={favs.includes(t)} onClick={() => star(t)}>{favs.includes(t) ? '★' : '☆'}</button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </>
      )}
    </aside>
  );
}
