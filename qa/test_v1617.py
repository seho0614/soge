"""v10.617 (docs/759) 파트너센터 메뉴 정리 — 계약 · 정산 예측 · 자료 내려받기를 메뉴 안 하위 링크로(메뉴 줄 12개는 그대로)
  ① (코드) PTC_NAV 12개 그대로 · PTC_SUB 세 메뉴(정산 · 실적 · 회사 · 계정) · BELONGS(계약 → 회사 · 계정 · 자료 내려받기 → 실적) · 코드에 한글 없음(test_v1100 규칙) ·
     사전 ko · en partner.shell.sub 6 + subAria · 같은 키 · 영어에 한글 없음 · CSS .pt-sub · 세 화면 파일 있음 · 문서 759 · 판
  ③ (사용자 웹 SITE 가 있을 때) 로그인 전 /partner/contracts · /partner/export · /partner/settlement/forecast 가 로그인으로 보냄(화면이 살아 있음)
  (읽기만 — 두 번 돌아도 통과)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


def strip_comments(t):
    t = re.sub(r'\{/\*[\s\S]*?\*/\}', '', t)
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    return re.sub(r'(^|[^:\'"`])//[^\n]*', r'\1', t)


"""시험 몸통"""
SH = rd('site/src/components/partner/PartnerShell.tsx')
KO, EN = rd('site/src/i18n/messages/ko/partner.json'), rd('site/src/i18n/messages/en/partner.json')
CSS = rd('site/src/styles/proto-partner.css')
nav = re.search(r'export const PTC_NAV = \[(.*?)\] as const;', SH, re.S)
ok('① 메뉴 줄 PTC_NAV 12개 그대로 · 하위 링크 PTC_SUB 세 메뉴 · 계약 · 정산 예측 · 자료 내려받기 · BELONGS',
   bool(nav) and len(re.findall(r"\['/partner[^']*', '\w+'\]", nav.group(1))) == 12
   and "'/partner/settlement': [['/partner/settlement', 'settlement'], ['/partner/settlement/forecast', 'forecast']]" in SH
   and "'/partner/stats': [['/partner/stats', 'stats'], ['/partner/export', 'export']]" in SH
   and "'/partner/business': [['/partner/business', 'business'], ['/partner/contracts', 'contracts']]" in SH
   and "['/partner/export', '/partner/stats']" in SH and "['/partner/contracts', '/partner/business']" in SH
   and 'data-ptc-sub={act}' in SH and ("t(`sub.${key}`)" in SH or "t(`sub.${key}` as never)" in SH) and "t('subAria')" in SH, '')
han = [ln.strip() for ln in strip_comments(SH).splitlines() if re.search('[가-힣]', ln)]
ok('① PartnerShell 코드에 한글 없음(주석 빼고 · test_v1100 규칙)', not han, ' | '.join(han[:2]))
try:
    ko, en = json.loads(KO)['shell'], json.loads(EN)['shell']
except Exception:
    ko, en = {}, {}
keys = ['settlement', 'forecast', 'stats', 'export', 'business', 'contracts']
ok('① 사전 partner.shell.sub 6 + subAria — ko · en 같은 키 · 영어에 한글 없음 · 메뉴 이름 12개 그대로',
   all(ko.get('sub', {}).get(k) and en.get('sub', {}).get(k) for k in keys) and set(ko.get('sub', {})) == set(en.get('sub', {})) == set(keys)
   and ko.get('subAria') and en.get('subAria') and not re.search('[가-힣]', json.dumps(en, ensure_ascii=False))
   and len(ko.get('nav', {})) == 12 and len(en.get('nav', {})) == 12, f"{ko.get('sub')}")
ok('① CSS .pt-sub(줄 · 링크 · 켜짐) · 세 화면 파일 있음',
   '.pt-sub { ' in CSS and '.pt-sub a.on {' in CSS
   and all(rd(f) for f in ('site/src/app/partner/contracts/page.tsx', 'site/src/app/partner/export/page.tsx', 'site/src/app/partner/settlement/forecast/page.tsx')), '')
ok('① 문서 759 · 판', all(f in doc('759_') for f in ('PTC_SUB', '메뉴 12개', '/partner/contracts')) and VT >= (10, 617), VER)

if SITE:
    bad = []
    for path in ('/partner/contracts', '/partner/export', '/partner/settlement/forecast'):
        try:
            class NoRedir(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *a, **k):
                    return None
            try:
                r = urllib.request.build_opener(NoRedir).open(SITE + path, timeout=90)
                code, loc = r.status, ''
            except urllib.error.HTTPError as e:
                code, loc = e.code, e.headers.get('Location') or ''
            if not (code in (302, 303, 307, 308) and '/login' in loc) and code != 200:
                bad.append(f'{path}:{code}')
        except Exception as e:
            bad.append(f'{path}:{str(e)[:40]}')
    ok('③ 로그인 전 세 화면 — 로그인으로 보냄(또는 200) · 500 없음', not bad, ' '.join(bad))
else:
    print('  (사용자 웹 SITE 없음 — ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
