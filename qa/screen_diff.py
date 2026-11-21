"""운영 반영 전 화면 비교 (v10.570 · docs/712) — 개발 점검판(15173 운영 화면 · 15174 사용자 웹)에서 주요 화면 20곳을 찍어 앞 결과와 그림 차이(%)를 셈

  python3 qa/screen_diff.py [--out ~/screen_diff] [--base <앞 결과 폴더>] [--label v10.570] [--threshold 1.0] [--fail-over 5]
                            [--admin http://localhost:15173] [--site http://localhost:15174]
                            [--pages <화면 목록.json>] [--full] [--only <id,id>]

  · 점검판이 떠 있을 때(SITE_MODE=prod ~/sgb-check.sh 갈래 realcheck 뒤 · 점검판을 내리기 전) 개발 서버에서 돌림 — **운영 서버에서 돌리는 도구가 아님**
  · 결과 폴더 <out>/<날짜_시각>_<판>/ : shots/<id>.png(이번) · base/<id>.png(앞 결과 베낌) · diff/<id>.png(바뀐 점 빨강) · index.html(한 장) · result.json
  · 앞 결과(--base 없으면 <out> 안에서 result.json 이 있는 가장 최근 폴더)가 없으면 이번 그림만 남기고 차이는 「처음」
  · 차이 % = 바뀐 점 수 / 전체 점 수(점마다 RGB 한 칸이라도 16 넘게 다르면 바뀜) · 크기가 다르면 100% · --threshold(처음 1.0%) 넘으면 「살펴볼 것」
  · --fail-over P: P% 넘는 화면이 하나라도 있으면 끝 코드 1(처음은 늘 0 — 보고용)
  · 흔들림 줄이기: 움직임 · 깜빡이는 커서 끔 · 네트워크 조용해진 뒤 1.5초 · <time> · [data-now] · [data-clock] · .toast 는 가림 · 창 크기 1440×900(전체 길이는 --full)
  · 로그인: 운영 화면 admin@x.com · 사용자 웹 buyer@x.com(비밀번호는 점검판 시험 값 · 약관 동의는 consent_ok.agree 로 먼저)
  · 그림 비교는 Pillow 가 있으면 Pillow, 없으면 브라우저 canvas 로(설치 없이 sgb-qa:v1 · 서버 어디서나)
"""
import base64, datetime, glob, html, json, os, sys, time

PW = os.environ.get('SGB_TEST_PW', 'sgb-dev-1234')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# 주요 화면 20곳 — id · 이름 · 어디(admin 운영 화면 로그인 · member 사용자 웹 로그인 · guest 사용자 웹 비로그인) · 주소
PAGES = [
    ('adm-home', '운영 › 대시보드', 'admin', '/#/home'),
    ('adm-glance', '운영 › 대표 한눈에', 'admin', '/#/opb-glance'),
    ('adm-alerts', '운영 › 위험감지 › 운영 알림', 'admin', '/#/ops-alerts'),
    ('adm-queue', '운영 › 검수 › 검수 큐', 'admin', '/#/queue'),
    ('adm-members', '운영 › 회원 › 회원', 'admin', '/#/members'),
    ('adm-inquiries', '운영 › 회원 › 1:1 문의', 'admin', '/#/inquiries'),
    ('adm-deals', '운영 › 거래 › 거래 모니터링', 'admin', '/#/deals'),
    ('adm-settlement', '운영 › 정산 › 정산', 'admin', '/#/settlement'),
    ('adm-hlt-orders', '운영 › 소개몰 › 소개몰 주문', 'admin', '/#/hlt-orders'),
    ('adm-settings', '운영 › 정책 › 전체 설정', 'admin', '/#/settings'),
    ('adm-checklist', '운영 › 관 관리 › 오픈 체크리스트', 'admin', '/#/checklist'),
    ('adm-acct-month', '운영 › 회계 › 월 마감', 'admin', '/#/acct-month'),
    ('site-home', '사용자 웹 › 첫 화면', 'guest', '/'),
    ('site-login', '사용자 웹 › 로그인', 'guest', '/login'),
    ('site-health', '사용자 웹 › 소개몰', 'guest', '/health'),
    ('site-search', '사용자 웹 › 검색', 'member', '/search'),
    ('site-community', '사용자 웹 › 소개광장', 'member', '/community'),
    ('site-support', '사용자 웹 › 고객센터', 'member', '/support'),
    ('site-manual', '사용자 웹 › 사용자 설명서', 'member', '/guide/manual'),
    ('site-my', '사용자 웹 › 나의공간', 'member', '/my'),
]
MASK = ['time', '[data-now]', '[data-clock]', '.toast']
STABLE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'


def opt(argv, k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d


def kit_version():
    """점검판 킷 판(~/kits/run/current/SGB_*/sgb/VERSION · KIT 환경 값이 있으면 그것) — 못 읽으면 ''"""
    cands = ([os.path.join(os.environ['KIT'], 'sgb', 'VERSION')] if os.environ.get('KIT') else []) + sorted(glob.glob(os.path.expanduser('~/kits/run/current/SGB_*/sgb/VERSION')))
    for c in cands:
        try:
            return open(c, encoding='utf-8').read().strip()
        except Exception:
            continue
    return ''


def latest_base(root, me):
    cands = sorted(d for d in glob.glob(os.path.join(root, '*')) if os.path.isdir(d) and os.path.abspath(d) != os.path.abspath(me)
                   and os.path.exists(os.path.join(d, 'result.json')))
    return cands[-1] if cands else None


def stable(pg):
    try:
        pg.add_style_tag(content=STABLE_CSS)
    except Exception:
        pass


def shoot(pg, url, path, full):
    pg.goto(url, wait_until='networkidle', timeout=120000)
    stable(pg)
    pg.wait_for_timeout(1500)
    masks = []
    for sel in MASK:
        try:
            masks.append(pg.locator(sel))
        except Exception:
            pass
    pg.screenshot(path=path, full_page=full, mask=masks, animations='disabled')


# ── 그림 비교 ──────────────────────────────────────────────────────
def diff_pil(a, b, out):
    from PIL import Image, ImageChops   # 없으면 ImportError → canvas
    ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if ia.size != ib.size:
        return 100.0, f'크기 다름 {ia.size} → {ib.size}'
    d = ImageChops.difference(ia, ib)
    mask = d.convert('L').point(lambda v: 255 if v > 16 else 0)
    changed = sum(1 for v in mask.getdata() if v)
    over = ib.copy()
    red = Image.new('RGB', ib.size, (230, 40, 40))
    over.paste(red, mask=mask)
    Image.blend(ib, over, 0.7).save(out)
    return round(changed * 100.0 / (ia.size[0] * ia.size[1]), 3), ''


CANVAS_JS = '''async ([a, b]) => {
  const load = (s) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = s; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) return { pct: 100, note: `크기 다름 ${ia.width}x${ia.height} → ${ib.width}x${ib.height}`, png: '' };
  const w = ia.width, h = ia.height;
  const c = (img) => { const k = document.createElement('canvas'); k.width = w; k.height = h; const x = k.getContext('2d'); x.drawImage(img, 0, 0); return [k, x, x.getImageData(0, 0, w, h)]; };
  const [, , da] = c(ia); const [kb, xb, db] = c(ib);
  const out = xb.createImageData(w, h); let n = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const ch = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2])) > 16;
    if (ch) { n++; out.data[i] = 230; out.data[i + 1] = 40; out.data[i + 2] = 40; out.data[i + 3] = 255; }
    else { out.data[i] = db.data[i]; out.data[i + 1] = db.data[i + 1]; out.data[i + 2] = db.data[i + 2]; out.data[i + 3] = 90; }
  }
  xb.clearRect(0, 0, w, h); xb.putImageData(out, 0, 0);
  return { pct: Math.round(n * 100000 / (w * h)) / 1000, note: '', png: kb.toDataURL('image/png') };
}'''


def diff_canvas(page, a, b, out):
    url = lambda p: 'data:image/png;base64,' + base64.b64encode(open(p, 'rb').read()).decode()
    r = page.evaluate(CANVAS_JS, [url(a), url(b)])
    if r.get('png'):
        open(out, 'wb').write(base64.b64decode(r['png'].split(',', 1)[1]))
    return float(r.get('pct', 100)), r.get('note', '')


def write_html(dst, meta, rows):
    e = html.escape
    over = [r for r in rows if r.get('pct') is not None and r['pct'] > meta['threshold']]
    errs = [r for r in rows if r.get('error')]
    tr = []
    for r in sorted(rows, key=lambda x: (-(x['pct'] if x.get('pct') is not None else -1), x['id'])):
        pct = '처음' if r.get('pct') is None and not r.get('error') else ('오류' if r.get('error') else f"{r['pct']:.3f}%")
        cls = 'bad' if r.get('error') or (r.get('pct') or 0) > meta['threshold'] else ''
        img = lambda p: f'<a href="{e(p)}"><img src="{e(p)}" loading="lazy" alt=""></a>' if p else '<span class="dim">—</span>'
        tr.append(f'<tr class="{cls}" data-id="{e(r["id"])}"><td><b>{e(r["name"])}</b><br><small class="dim">{e(r["id"])} · {e(r["url"])}</small>'
                  f'{"<br><small>" + e(r.get("note") or r.get("error") or "") + "</small>" if (r.get("note") or r.get("error")) else ""}</td>'
                  f'<td class="num">{pct}</td><td>{img(r.get("base"))}</td><td>{img(r.get("shot"))}</td><td>{img(r.get("diff"))}</td></tr>')
    doc = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>화면 비교 {e(meta["label"])}</title>
<style>
:root {{ --bg:#f7f8fa; --card:#fff; --ink:#1d2433; --ink3:#6b7385; --line:#e3e6ec; --bad:#c62828; --badbg:#fdecec; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#14171d; --card:#1c2029; --ink:#e7eaf0; --ink3:#9aa3b5; --line:#2c3240; --bad:#ff6b6b; --badbg:#3a1d1d; }} }}
body {{ margin:0; padding:16px; background:var(--bg); color:var(--ink); font:14px/1.5 system-ui, sans-serif; }}
h1 {{ font-size:20px; margin:0 0 8px; }} .dim {{ color:var(--ink3); }}
table {{ width:100%; border-collapse:collapse; background:var(--card); }} td, th {{ border-bottom:1px solid var(--line); padding:8px; vertical-align:top; text-align:left; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }} tr.bad td {{ background:var(--badbg); }} tr.bad td.num {{ color:var(--bad); font-weight:700; }}
img {{ width:240px; max-width:100%; border:1px solid var(--line); border-radius:7px; }}
.wrap {{ overflow-x:auto; }}
</style></head><body>
<h1>화면 비교 — {e(meta["label"])}</h1>
<p>찍은 때 {e(meta["at"])} · 앞 결과 {e(meta["baseLabel"] or "없음(처음)")} · 화면 {len(rows)}곳 · 기준 {meta["threshold"]}% 넘음 <b>{len(over)}</b> · 오류 <b>{len(errs)}</b> · 비교 방법 {e(meta["engine"])}</p>
<p class="dim">차이 % = 바뀐 점 / 전체 점(RGB 한 칸이라도 16 넘게 다르면 바뀜) · 시각 · 시계 칸은 가림 · 크기가 다르면 100%. 숫자가 큰 화면부터 직접 열어 확인하십시오(개발 점검판 기준 · 운영 서버 아님).</p>
<div class="wrap"><table><thead><tr><th>화면</th><th>차이</th><th>앞 결과</th><th>이번</th><th>바뀐 점</th></tr></thead><tbody>
{"".join(tr)}
</tbody></table></div></body></html>'''
    open(dst, 'w', encoding='utf-8').write(doc)


def main(argv):
    root = os.path.expanduser(opt(argv, '--out', '~/screen_diff'))
    admin, site = opt(argv, '--admin', os.environ.get('ADMIN_WEB') or 'http://localhost:15173'), opt(argv, '--site', os.environ.get('SITE') or 'http://localhost:15174')
    thr, fail_over, full = float(opt(argv, '--threshold', '1.0')), opt(argv, '--fail-over'), '--full' in argv
    pages = PAGES
    if opt(argv, '--pages'):
        pages = [tuple(x) for x in json.load(open(opt(argv, '--pages'), encoding='utf-8'))]
    if opt(argv, '--only'):
        keep = set(opt(argv, '--only').split(','))
        pages = [p for p in pages if p[0] in keep]
    label = opt(argv, '--label') or kit_version() or 'dev'
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M')
    me = os.path.join(root, f'{stamp}_{label}'.replace('/', '_'))
    for sub in ('shots', 'base', 'diff'):
        os.makedirs(os.path.join(me, sub), exist_ok=True)
    base = opt(argv, '--base') or latest_base(root, me)
    base_meta = json.load(open(os.path.join(base, 'result.json'), encoding='utf-8')) if base and os.path.exists(os.path.join(base, 'result.json')) else {}

    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        print('playwright 가 없습니다 — sgb-qa:v1 컨테이너 안에서 돌리거나 pip 로 설치하십시오.'); return 2
    try:
        __import__('consent_ok').agree('buyer@x.com', PW)
    except Exception:
        pass
    try:
        import PIL  # noqa: F401
        engine = 'Pillow'
    except Exception:
        engine = '브라우저 canvas'

    rows, t0 = [], time.time()
    with sync_playwright() as p:
        b = p.chromium.launch()
        vp = {'width': 1440, 'height': 900}
        ctx = {k: b.new_context(viewport=vp, locale='ko-KR', timezone_id='Asia/Seoul') for k in ('admin', 'member', 'guest')}
        logged = {}
        cmp_box = []

        def cmp_page():
            """그림 비교용 빈 쪽(about:blank) — 하나만 만들어 다시 씀"""
            if not cmp_box:
                cmp_box.append(b.new_page())
            return cmp_box[0]

        def page_for(kind):
            pg = ctx[kind].pages[0] if ctx[kind].pages else ctx[kind].new_page()
            if kind in logged:
                return pg
            logged[kind] = True
            try:
                if kind == 'admin':
                    pg.goto(admin + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                elif kind == 'member':
                    pg.goto(site + '/login', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'buyer@x.com'); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(2500)
            except Exception as ex:
                logged[kind] = f'로그인 실패 {str(ex)[:80]}'
            return pg

        for pid, name, kind, path in pages:
            url = (admin if kind == 'admin' else site) + path
            r = {'id': pid, 'name': name, 'kind': kind, 'url': path, 'pct': None, 'note': '', 'shot': None, 'base': None, 'diff': None}
            shot = os.path.join(me, 'shots', pid + '.png')
            try:
                pg = page_for(kind)
                if isinstance(logged.get(kind), str):
                    r['note'] = logged[kind]
                shoot(pg, url, shot, full)
                r['shot'] = f'shots/{pid}.png'
            except Exception as ex:
                r['error'] = f'찍지 못함: {str(ex)[:160]}'
                rows.append(r); continue
            old = os.path.join(base, 'shots', pid + '.png') if base else None
            if old and os.path.exists(old):
                cp = os.path.join(me, 'base', pid + '.png')
                open(cp, 'wb').write(open(old, 'rb').read())
                r['base'] = f'base/{pid}.png'
                dpath = os.path.join(me, 'diff', pid + '.png')
                pct, note = None, ''
                try:
                    if engine == 'Pillow':
                        pct, note = diff_pil(old, shot, dpath)
                    else:
                        pct, note = diff_canvas(cmp_page(), old, shot, dpath)
                except Exception as ex:
                    try:   # Pillow 가 실패하면 canvas 로 한 번 더
                        pct, note = diff_canvas(cmp_page(), old, shot, dpath)
                    except Exception as ex2:
                        r['error'] = f'비교 실패: {str(ex)[:60]} / {str(ex2)[:60]}'
                r['pct'], r['note'] = pct, (r['note'] + ' ' + note).strip()
                if os.path.exists(dpath):
                    r['diff'] = f'diff/{pid}.png'
            rows.append(r)
            print(f"  {pid:16} {'처음' if r['pct'] is None else str(r['pct']) + '%'} {r['note']}", flush=True)
        b.close()

    meta = {'label': label, 'at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'threshold': thr, 'engine': engine,
            'base': base, 'baseLabel': base_meta.get('label') if base_meta else None, 'admin': admin, 'site': site, 'seconds': round(time.time() - t0)}
    json.dump({**meta, 'rows': rows}, open(os.path.join(me, 'result.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    write_html(os.path.join(me, 'index.html'), meta, rows)
    over = [r for r in rows if (r.get('pct') or 0) > thr]
    errs = [r for r in rows if r.get('error')]
    print(f"화면 비교 — {len(rows)}곳 · 기준 {thr}% 넘음 {len(over)} · 오류 {len(errs)} · 앞 결과 {meta['baseLabel'] or '없음'} · 결과 {os.path.join(me, 'index.html')}")
    if fail_over is not None and any((r.get('pct') or 0) > float(fail_over) for r in rows):
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
