"""v10.595 (docs/737) ⑪ 사용자 웹 접근성 자동 점검 — 결과 html · json

  쓰는 법(개발 서버 점검판 · 운영 접속 없음):
    SITE=http://localhost:15174 python3 qa/a11y_check.py [--out 폴더] [--pages /,/login,...] [--axe 파일/axe.min.js] [--fail-on N]
    python3 qa/a11y_check.py --selftest            # 브라우저로 내장 시험 쪽(문제 7가지를 일부러 넣은 html) 하나만 · 사이트 없이

  보는 것(브라우저 안 스크립트 · 바깥으로 보내는 것 없음 · 새 패키지 없음 — playwright 만):
    LANG      <html lang> 없음                       TITLE   <title> 없음 · 비어 있음
    IMG_ALT   alt 없는 그림(장식이면 alt="")           NAME    이름 없는 단추 · 링크(글자 · aria-label · title · 안 그림 alt 모두 없음)
    LABEL     이름표 없는 입력칸(label · aria-label · aria-labelledby · title · placeholder 만은 경고)
    DUP_ID    같은 id 두 번 이상                     HEADING 제목 단계 건너뜀(h1 → h3) · h1 없음
    CONTRAST  글자 대비 4.5:1 미만(큰 글자 3:1) — 겹친 배경색을 위로 따라가 계산(그림 배경은 셈하지 않음)
    TABINDEX  tabindex > 0(누름 순서 꼬임)          HIDDEN_FOCUS aria-hidden 안에 누를 수 있는 것
    TARGET    휴대폰 폭(390px)에서 누름 칸 24px 미만(WCAG 2.2 AA 2.5.8) — 44px 미만은 「권함」
  --axe 로 axe-core 파일을 주면 그 결과도 함께(파일은 이 도구가 내려받지 않음).
  종료 코드: 0(문제 수 상관없이) · --fail-on N 이면 「오류」가 N 개 넘을 때 1 · 사이트가 안 열리면 2.
"""
import argparse, datetime, html, json, os, sys

DEFAULT_PAGES = ['/', '/login', '/signup', '/search', '/money', '/mal', '/biz', '/mall', '/community', '/support', '/guide/manual', '/safety']

CHECK_JS = r"""
() => {
  const out = [];
  const add = (code, level, el, msg) => {
    let sel = '';
    try { sel = el ? (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) : ''; } catch (e) {}
    const text = el ? (el.innerText || el.getAttribute('aria-label') || el.getAttribute('src') || '').trim().slice(0, 60) : '';
    out.push({ code, level, sel, text, msg });
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const nameOf = (el) => {
    const a = (el.getAttribute('aria-label') || '').trim(); if (a) return a;
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map((i) => document.getElementById(i)?.innerText || '').join(' ').trim(); if (t) return t; }
    const t = (el.innerText || '').trim(); if (t) return t;
    const im = el.querySelector('img[alt]'); if (im && im.getAttribute('alt').trim()) return im.getAttribute('alt');
    const sv = el.querySelector('svg title'); if (sv && sv.textContent.trim()) return sv.textContent;
    return (el.getAttribute('title') || el.getAttribute('value') || '').trim();
  };
  if (!document.documentElement.getAttribute('lang')) add('LANG', 'error', document.documentElement, '<html lang> 이 없습니다');
  if (!(document.title || '').trim()) add('TITLE', 'error', null, '<title> 이 비어 있습니다');
  document.querySelectorAll('img').forEach((im) => { if (!im.hasAttribute('alt') && vis(im)) add('IMG_ALT', 'error', im, 'alt 가 없는 그림'); });
  document.querySelectorAll('button, a[href], [role=button], [role=link]').forEach((el) => { if (vis(el) && !nameOf(el)) add('NAME', 'error', el, '이름 없는 단추 · 링크'); });
  document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea').forEach((el) => {
    if (!vis(el)) return;
    const id = el.id; const lab = (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) || el.closest('label');
    if (lab || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return;
    if (el.getAttribute('placeholder')) add('LABEL', 'warn', el, '이름표 없이 안내 글(placeholder)만 — 글자를 넣으면 사라짐');
    else add('LABEL', 'error', el, '이름표 없는 입력칸');
  });
  const ids = {}; document.querySelectorAll('[id]').forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; });
  Object.entries(ids).filter(([, n]) => n > 1).forEach(([id, n]) => add('DUP_ID', 'error', document.getElementById(id), 'id 「' + id + '」 ' + n + '번'));
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).map((h) => +h.tagName[1]);
  if (!hs.includes(1)) add('HEADING', 'warn', null, 'h1 이 없습니다');
  for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) { add('HEADING', 'warn', null, 'h' + hs[i - 1] + ' 다음 h' + hs[i] + ' — 단계 건너뜀'); break; }
  document.querySelectorAll('[tabindex]').forEach((el) => { if (+el.getAttribute('tabindex') > 0) add('TABINDEX', 'warn', el, 'tabindex > 0'); });
  document.querySelectorAll('[aria-hidden=true] a[href], [aria-hidden=true] button, [aria-hidden=true] input, [aria-hidden=true] [tabindex="0"]').forEach((el) => add('HIDDEN_FOCUS', 'error', el, 'aria-hidden 안의 누를 수 있는 것'));
  /* 대비 — 보이는 글자 덩어리 400개까지 */
  const rgb = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => { let e = el; while (e && e.nodeType === 1) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== 'none') return null; const c = rgb(s.backgroundColor); if (c && c.a >= 0.99) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  let n = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode() && n < 400) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || seen.has(el) || !vis(el)) continue; seen.add(el); n++;
    const s = getComputedStyle(el); const fg = rgb(s.color); const bg = bgOf(el); if (!fg || !bg) continue;
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(s.fontSize); const big = px >= 24 || (px >= 18.66 && (+s.fontWeight >= 700));
    if (ratio < (big ? 3 : 4.5)) add('CONTRAST', 'error', el, '대비 ' + ratio.toFixed(2) + ':1 (' + (big ? '큰 글자 3' : '4.5') + ':1 미만)');
  }
  return out;
}
"""

TARGET_JS = r"""
() => {
  const out = [];
  document.querySelectorAll('button, a[href], [role=button], input[type=checkbox], input[type=radio], select').forEach((el) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0) || s.visibility === 'hidden') return;
    if (el.tagName === 'A' && s.display === 'inline' && el.closest('p, li, td')) return;   /* 문장 안 링크는 빼기(WCAG 예외) */
    const m = Math.min(r.width, r.height);
    const sel = el.id ? '#' + el.id : el.tagName.toLowerCase();
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40);
    if (m < 24) out.push({ code: 'TARGET', level: 'error', sel, text, msg: '누름 칸 ' + Math.round(m) + 'px — 24px 미만' });
    else if (m < 44) out.push({ code: 'TARGET', level: 'info', sel, text, msg: '누름 칸 ' + Math.round(m) + 'px — 44px 권함' });
  });
  return out.slice(0, 80);
}
"""

SELFTEST_HTML = """<!doctype html><html><head><meta charset="utf-8"></head><body>
<img src="x.png" width="40" height="40" style="display:inline-block;width:40px;height:40px"><button></button><a href="/x"></a><input id="q"><div id="d"></div><div id="d"></div>
<h1>제목</h1><h3>건너뜀</h3><p style="color:#bbb;background:#fff">흐린 글자</p><div aria-hidden="true"><a href="/y">숨은 링크</a></div>
<span tabindex="3">순서</span></body></html>"""
SELFTEST_WANT = {'LANG', 'TITLE', 'IMG_ALT', 'NAME', 'LABEL', 'DUP_ID', 'HEADING', 'CONTRAST', 'HIDDEN_FOCUS', 'TABINDEX'}


def run_page(pg, url, axe_src, html_text=None):
    if html_text is not None:
        pg.set_content(html_text)
    else:
        pg.goto(url, wait_until='networkidle', timeout=60000)
        pg.wait_for_timeout(800)
    found = pg.evaluate(CHECK_JS)
    if axe_src:
        try:
            pg.add_script_tag(content=axe_src)
            res = pg.evaluate("async () => { const r = await axe.run(document, { resultTypes: ['violations'] }); return r.violations.map(v => ({ code: 'AXE_' + v.id, level: v.impact === 'critical' || v.impact === 'serious' ? 'error' : 'warn', sel: (v.nodes[0] && v.nodes[0].target.join(' ')) || '', text: '', msg: v.help + ' (' + v.nodes.length + ')' })); }")
            found += res
        except Exception as ex:
            found.append({'code': 'AXE_FAIL', 'level': 'info', 'sel': '', 'text': '', 'msg': str(ex)[:120]})
    return found


def report_html(rows, started, site):
    esc = html.escape
    tot = {'error': 0, 'warn': 0, 'info': 0}
    for r in rows:
        for f in r['found']:
            tot[f['level']] = tot.get(f['level'], 0) + 1
    body = [f"<h1>사용자 웹 접근성 점검</h1><p>{esc(site)} · {esc(started)} · 오류 {tot['error']} · 경고 {tot['warn']} · 권함 {tot['info']}</p>",
            '<table><thead><tr><th>쪽</th><th>폭</th><th>오류</th><th>경고</th><th>권함</th></tr></thead><tbody>']
    for r in rows:
        c = {k: sum(1 for f in r['found'] if f['level'] == k) for k in ('error', 'warn', 'info')}
        body.append(f"<tr><td><a href='#{esc(r['id'])}'>{esc(r['path'])}</a></td><td>{r['width']}</td><td class='e'>{c['error']}</td><td>{c['warn']}</td><td>{c['info']}</td></tr>")
    body.append('</tbody></table>')
    for r in rows:
        body.append(f"<h2 id='{esc(r['id'])}'>{esc(r['path'])} · {r['width']}px{(' — ' + esc(r['error'])) if r.get('error') else ''}</h2>")
        if not r['found']:
            body.append('<p>문제 없음</p>')
            continue
        body.append('<table><thead><tr><th>종류</th><th>정도</th><th>자리</th><th>글</th><th>설명</th></tr></thead><tbody>')
        for f in r['found'][:200]:
            body.append(f"<tr class='{f['level']}'><td>{esc(f['code'])}</td><td>{esc(f['level'])}</td><td><code>{esc(f['sel'])}</code></td><td>{esc(f['text'])}</td><td>{esc(f['msg'])}</td></tr>")
        body.append('</tbody></table>')
    css = ('body{font-family:system-ui,sans-serif;margin:16px;color:#222;background:#fff}table{border-collapse:collapse;width:100%;margin:8px 0 20px}'
           'th,td{border:1px solid #ddd;padding:4px 8px;font-size:13px;text-align:left}tr.error td{background:#fff1f0}td.e{color:#b42318;font-weight:700}code{font-size:12px}')
    return f"<!doctype html><html lang='ko'><head><meta charset='utf-8'><title>접근성 점검</title><style>{css}</style></head><body>{''.join(body)}</body></html>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out_a11y'))
    ap.add_argument('--pages', default=','.join(DEFAULT_PAGES))
    ap.add_argument('--axe', default='')
    ap.add_argument('--fail-on', type=int, default=-1)
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        print('playwright 가 없습니다 — 점검판 qa 이미지에서 돌리십시오'); return 2
    axe_src = open(a.axe, encoding='utf-8').read() if a.axe and os.path.exists(a.axe) else ''
    started = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    if a.selftest:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
            found = run_page(pg, None, '', SELFTEST_HTML); b.close()
        codes = {f['code'] for f in found}
        miss = SELFTEST_WANT - codes
        print('셀프 시험', '통과' if not miss else '빠짐 ' + ','.join(sorted(miss)), '— 찾은 종류', ','.join(sorted(codes)))
        return 0 if not miss else 1
    site = (os.environ.get('SITE') or '').rstrip('/')
    if not site:
        print('SITE 가 없습니다(예: SITE=http://localhost:15174)'); return 2
    os.makedirs(a.out, exist_ok=True)
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for width in (1280, 390):
            pg = b.new_page(viewport={'width': width, 'height': 900})
            for i, path in enumerate([x.strip() for x in a.pages.split(',') if x.strip()]):
                r = {'id': f'p{width}_{i}', 'path': path, 'width': width, 'found': []}
                try:
                    r['found'] = run_page(pg, site + path, axe_src)
                    if width == 390:
                        r['found'] = [f for f in r['found'] if f['code'] in ('CONTRAST', 'NAME')] + pg.evaluate(TARGET_JS)
                except Exception as ex:
                    r['error'] = str(ex)[:160]
                rows.append(r)
            pg.close()
        b.close()
    if rows and all(r.get('error') for r in rows):
        print('사이트가 열리지 않습니다 —', rows[0]['error']); return 2
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M')
    jp = os.path.join(a.out, f'a11y_{stamp}.json'); hp = os.path.join(a.out, f'a11y_{stamp}.html')
    json.dump({'site': site, 'started': started, 'rows': rows}, open(jp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(hp, 'w', encoding='utf-8').write(report_html(rows, started, site))
    errs = sum(1 for r in rows for f in r['found'] if f['level'] == 'error')
    print(f'접근성 점검 — 쪽 {len(rows)} · 오류 {errs} · 결과 {hp}')
    return 1 if (a.fail_on >= 0 and errs > a.fail_on) else 0


if __name__ == '__main__':
    sys.exit(main())
