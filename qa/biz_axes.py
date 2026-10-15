"""소개창업 「인력 · 운영지원 · 정보」 축 — 목록의 줄마다 단추를 눌러 무엇이 열리는지 조사합니다 (2026-10-07 · 읽기만 · 시안을 고치지 않습니다).

  python3 biz_axes.py            → biz_axes.json · biz_axes_{축}_{갈래}_{1500|390}.png

조사하는 것
  1. 축 3개 × 갈래(인력: 공고 · 지원 · 빠른 매칭 / 운영지원: 없음 / 정보: 정책 소개 · 창업 교육)의 줄 목록
  2. 줄의 단추를 하나씩 눌러 — 화면이 바뀌는지(상세로 가는지) · 안내 글만 뜨는지 · 아무 일도 없는지
  3. 그 밖의 단추(띠 · 찾기 양식 · 옆 칸)
  4. 축을 골랐을 때 주소가 바뀌는지 · 주소로 바로 열 수 있는지 · 다른 화면에 갔다 돌아오면 축이 남는지
  5. 글 점검 — 옛 관 이름 · 지난 날짜 · undefined · 화면 오류 · 390px 가로 넘침
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

FILE = os.environ.get('PROTO', '/mnt/user-data/outputs/SGB_Prototype_v10_21.html')   # v10.21 시안을 조사한 도구입니다 — v10.22 에서 고친 뒤의 확인은 proto_axis.py
OUT = os.environ.get('OUT', '/home/claude/qa')
AXES = [('2', '인력', ['공고', '지원', '빠른 매칭'], 'axjob'), ('3', '운영지원', [None], None), ('4', '정보', ['정책', '교육'], 'axinfo')]
TODAY = (2026, 10, 7)

BODY = """() => {
  const lay = document.querySelector('.gwl .lay'); if (!lay) return null;
  const col = lay.children[lay.children.length - 1];
  const els = [...col.querySelectorAll('button, a')].filter(e => !e.classList.contains('axd'));
  return els.map((e, i) => {
    const row = e.closest('.axrow');
    return { i, tag: e.tagName, label: e.textContent.trim(), cls: e.className, disabled: !!e.disabled,
             go: e.getAttribute('data-go'), t: e.getAttribute('data-t'), href: e.getAttribute('href'),
             row: row ? (row.querySelector('.axl b') || {}).textContent || '' : '',
             badge: row ? (row.querySelector('.axb') || {}).textContent || '' : '',
             sub: row ? (row.querySelector('.axl .ls') || {}).textContent || '' : '',
             price: row ? (row.querySelector('.axr > b') || {}).textContent || '' : '',
             where: row ? '줄' : (e.closest('.axurg') ? '띠' : e.closest('.axcta') ? '아래 안내' : e.closest('.qmf') ? '찾기 양식' : '그 밖') };
  });
}"""
CLICK = """(i) => { const lay = document.querySelector('.gwl .lay'); const col = lay.children[lay.children.length - 1];
  const els = [...col.querySelectorAll('button, a')].filter(e => !e.classList.contains('axd')); els[i].click(); }"""
SIDE = """() => { const a = document.querySelector('.gwl .lay aside'); if (!a) return [];
  return [...a.querySelectorAll('button, a')].map((e, i) => ({ i, label: e.textContent.trim(), go: e.getAttribute('data-go'), t: e.getAttribute('data-t') })); }"""
SIDECLICK = "(i) => { const a = document.querySelector('.gwl .lay aside'); [...a.querySelectorAll('button, a')][i].click(); }"
TOAST = "() => { const e = document.getElementById('toast'); return e && e.classList.contains('on') ? e.textContent.trim() : ''; }"
STATE = "() => ({ screen: __VIEW.state.screen, hash: location.hash, ax: __VIEW.state.axBIZ || null, sub1: __VIEW.state.axjob || null, sub2: __VIEW.state.axinfo || null })"


def main():
    res = {'file': os.path.basename(FILE), 'axes': [], 'errors': [], 'address': {}, 'text': []}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1500, 'height': 1000})
        pg.on('pageerror', lambda e: res['errors'].append('pageerror: ' + str(e)[:200]))
        pg.on('console', lambda m: res['errors'].append('console: ' + m.text[:200]) if m.type == 'error' else None)

        def enter(k, sub, key):
            pg.goto('file://' + FILE + '#/g/biz'); pg.wait_for_timeout(700)
            pg.evaluate("() => { const e = document.getElementById('toast'); e && e.classList.remove('on'); }")
            pg.click(f'button.axt[data-x="axBIZ"][data-xv="{k}"]'); pg.wait_for_timeout(250)
            if sub: pg.click(f'button.axd[data-x="{key}"][data-xv="{sub}"]'); pg.wait_for_timeout(250)

        pg.goto('file://' + FILE + '#/g/biz'); pg.wait_for_timeout(1500)
        res['landing'] = pg.evaluate(STATE)
        res['tabs'] = pg.evaluate("() => [...document.querySelectorAll('button.axt')].map(e => ({ k: e.getAttribute('data-xv'), nm: e.querySelector('b').textContent, sub: e.querySelector('span').textContent, gate: (e.querySelector('.axg') || {}).textContent || '', on: e.classList.contains('on') }))")

        for k, nm, subs, key in AXES:
            for sub in subs:
                enter(k, sub, key)
                st0 = pg.evaluate(STATE)
                note = pg.evaluate("() => (document.querySelector('.axnote') || {}).innerText || ''")
                els = pg.evaluate(BODY)
                text = pg.evaluate("() => document.querySelector('.gwl').innerText")
                tag = f"{nm}_{sub or '전체'}".replace(' ', '')
                pg.screenshot(path=f'{OUT}/biz_axes_{tag}_1500.png', full_page=True)
                rows = []
                for e in els:
                    enter(k, sub, key)
                    if e['disabled']:
                        rows.append({**e, 'result': '눌리지 않음(비활성)'}); continue
                    pg.evaluate(CLICK, e['i']); pg.wait_for_timeout(380)
                    st1 = pg.evaluate(STATE); toast = pg.evaluate(TOAST)
                    moved = st1['screen'] != st0['screen'] or st1['hash'] != st0['hash']
                    r = {**e, 'toast': toast, 'to_screen': st1['screen'] if moved else '', 'to_hash': st1['hash'] if moved else '',
                         'result': '화면 이동' if moved else ('안내 글만' if toast else '반응 없음')}
                    if moved:
                        r['to_title'] = pg.evaluate("() => (document.querySelector('#screen h1, #screen h2, #screen .sh2 b') || {}).textContent || ''").strip()[:60]
                        # 돌아오면 축이 남는가
                        pg.go_back(); pg.wait_for_timeout(400); st2 = pg.evaluate(STATE)
                        on = pg.evaluate("() => (document.querySelector('button.axt.on b') || {}).textContent || ''")
                        r['back'] = {'screen': st2['screen'], 'hash': st2['hash'], 'axis_on': on}
                    rows.append(r)
                # 390px
                pg.set_viewport_size({'width': 390, 'height': 844}); enter(k, sub, key)
                over = pg.evaluate("() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth, wide: [...document.querySelectorAll('.gwl *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map(e => e.tagName + '.' + String(e.className).slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().right)) })")
                pg.screenshot(path=f'{OUT}/biz_axes_{tag}_390.png', full_page=True)
                pg.set_viewport_size({'width': 1500, 'height': 1000})
                res['axes'].append({'k': k, 'axis': nm, 'sub': sub, 'state': st0, 'note': note, 'rows': rows, 'mobile': over, 'text': text})

        # 옆 칸 단추 (축 3개에서 같음 — 인력 축에서 한 번)
        enter('2', None, None); side = pg.evaluate(SIDE); sres = []
        for e in side:
            enter('2', None, None); st0 = pg.evaluate(STATE)
            pg.evaluate(SIDECLICK, e['i']); pg.wait_for_timeout(380); st1 = pg.evaluate(STATE)
            sres.append({**e, 'toast': pg.evaluate(TOAST), 'to_screen': st1['screen'] if st1['screen'] != st0['screen'] else '', 'to_hash': st1['hash'] if st1['hash'] != st0['hash'] else ''})
        res['side'] = sres

        # 주소 — 축을 골랐을 때 주소가 바뀌는가 · 새로 열면 남는가
        for k, nm, subs, key in AXES:
            enter(k, None, None); h = pg.evaluate("location.hash")
            pg.reload(); pg.wait_for_timeout(900)
            on = pg.evaluate("() => (document.querySelector('button.axt.on b') || {}).textContent || ''")
            res['address'][nm] = {'hash_after_select': h, 'axis_after_reload': on}
        b.close()

    # 글 점검
    for a in res['axes']:
        t = a['text']; where = f"{a['axis']} · {a['sub'] or '전체'}"
        for old in ('소개머니', '소개몰', '소개리드'):
            for m in re.finditer(old, t): res['text'].append({'where': where, 'kind': '옛 관 이름', 'found': t[max(0, m.start() - 25):m.start() + 30].replace('\n', ' ')})
        if 'undefined' in t or 'NaN' in t or '[object' in t: res['text'].append({'where': where, 'kind': '깨진 값', 'found': 'undefined / NaN / [object'})
        for m in re.finditer(r'~\s*(20\d\d)-(\d\d)-(\d\d)', t):
            d = tuple(int(x) for x in m.groups())
            if d < TODAY: res['text'].append({'where': where, 'kind': '지난 날짜', 'found': t[max(0, m.start() - 40):m.end()].replace('\n', ' ')})
        for m in re.finditer(r'(\d{1,2})/(\d{1,2})', t):
            mo, da = int(m.group(1)), int(m.group(2))
            if 1 <= mo <= 12 and (2026, mo, da) < TODAY: res['text'].append({'where': where, 'kind': '지난 날짜', 'found': t[max(0, m.start() - 30):m.end() + 8].replace('\n', ' ')})
        for w in ('채용', '고용', '구직자'):
            n = t.count(w)
            if n: res['text'].append({'where': where, 'kind': f'낱말 「{w}」', 'found': f'{n}번'})
        a.pop('text')
    json.dump(res, open(f'{OUT}/biz_axes.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    n = sum(len(a['rows']) for a in res['axes'])
    kinds = {}
    for a in res['axes']:
        for r in a['rows']: kinds[r['result']] = kinds.get(r['result'], 0) + 1
    print('단추', n, kinds, '· 화면 오류', len(res['errors']), '· 글 점검', len(res['text']))


if __name__ == '__main__':
    main()
