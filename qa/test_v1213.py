"""v10.213 (docs/342) — 약관 「게시」가 막힌 까닭을 글자로 · 빈칸 수 셈을 하나로

  ① (코드) 약관 표 빈칸은 같은 것을 한 번만(Set) · 「게시」 옆 까닭(data-term-publish-why) · 문서 342 · 판
  ② (화면) LOCATION 2.0 초안(빈칸 4) → 「〔미확정〕 4곳」 까닭 · 같은 빈칸을 두 번 넣어도 4 · 빈칸을 채우면 「시행일을 먼저」 →
     시행일을 넣으면 까닭이 사라지고 「게시」가 눌림(누르지 않음) · 끝나면 본문 · 상태 되돌림
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


TP = rd('web/src/app/admin/TermsPanel.tsx')
ok('① 약관 표 빈칸 — 같은 것은 한 번만(Set · 〔시행일〕 뺌)',
   "const holes = (b: string) => [...new Set(b.match(/〔[^〕]*〕/g) ?? [])].filter((m) => m !== '〔시행일〕');" in TP, '')
ok('① 「게시」 옆 막힌 까닭 — 빈칸 · 본문 없음 · 시행일',
   'data-term-publish-why=' in TP and '게시 막힘 — 〔미확정〕' in TP and '게시하려면 표 위 「시행일」을 먼저 넣으십시오' in TP, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('342_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 342 · 판 v10.213 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 213), f'{DOC} · {rd("VERSION").strip()}')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


if API and DB and ADMIN_WEB:
    # 점검판 시드는 LOCATION 을 모두 보관으로 둠 → 이 시험 동안만 2.0 을 초안으로 · 본문도 끝나면 원래대로
    s20 = psql("SELECT status FROM terms WHERE code = 'LOCATION' AND version = '2.0'")
    b20 = psql("SELECT body FROM terms WHERE code = 'LOCATION' AND version = '2.0'")
    good = s20 and not s20.startswith('!') and b20 and not b20.startswith('!') and '$b$' not in b20
    seen, errs = {}, []
    try:
        if good and s20 != 'DRAFT':
            psql("UPDATE terms SET status = 'DRAFT' WHERE code = 'LOCATION' AND version = '2.0'")
        # 같은 빈칸을 한 번 더(〔보관 기간〕 두 번) — 표는 여전히 4곳
        psql("UPDATE terms SET body = body || E'\\n\\n덧붙임 〔보관 기간〕' WHERE code = 'LOCATION' AND version = '2.0'")
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)

            def row():
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.reload(wait_until='networkidle'); pg.wait_for_timeout(2500)
                return pg.locator('[data-term-row="LOCATION:2.0"]')
            r = row()
            seen['holes'] = r.get_attribute('data-holes')
            w = r.locator('[data-term-publish-why]')
            seen['why1'] = w.get_attribute('data-term-publish-why') if w.count() else ''
            seen['text1'] = w.inner_text() if w.count() else ''
            psql("UPDATE terms SET body = regexp_replace(body, '〔(?!시행일〕)[^〕]*〕', '채움', 'g') WHERE code = 'LOCATION' AND version = '2.0'")
            r = row()
            w = r.locator('[data-term-publish-why]')
            seen['why2'] = w.get_attribute('data-term-publish-why') if w.count() else ''
            seen['dis2'] = r.locator('[data-term-publish]').is_disabled()
            pg.fill('[data-terms-date]', '2099-12-31'); pg.wait_for_timeout(500)
            seen['why3'] = r.locator('[data-term-publish-why]').count()
            seen['dis3'] = r.locator('[data-term-publish]').is_disabled()
            b.close()
    except Exception as ex:
        errs.append(str(ex)[:160])
    finally:
        if good:
            psql(f"UPDATE terms SET body = $b${b20}$b$ WHERE code = 'LOCATION' AND version = '2.0'")
            if s20 != 'DRAFT':
                psql(f"UPDATE terms SET status = '{s20}' WHERE code = 'LOCATION' AND version = '2.0'")
    back = psql("SELECT status || ':' || md5(body) FROM terms WHERE code = 'LOCATION' AND version = '2.0'")
    ok('② 빈칸 4 — 같은 빈칸 두 번이어도 4 · 까닭 「〔미확정〕 4곳」', seen.get('holes') == '4' and seen.get('why1') == 'holes' and '4곳' in seen.get('text1', '') and not errs, f'{seen} · {errs[:2]}')
    ok('② 빈칸을 채우면 「시행일을 먼저」 · 「게시」 막힘 → 시행일을 넣으면 까닭 없음 · 「게시」 눌림',
       seen.get('why2') == 'day' and seen.get('dis2') is True and seen.get('why3') == 0 and seen.get('dis3') is False and not errs, f'{seen} · {errs[:2]}')
    ok('② 끝나면 2.0 상태 · 본문 원래대로', good and back == f"{s20}:" + psql(f"SELECT md5($b${b20}$b$)"), f'{back}')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
