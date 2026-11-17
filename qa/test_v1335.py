"""v10.335 (docs/466 · 467) 리드관(소개리드) 되살림 — 꺼진 채(D227)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1335.py
  ① (코드) D227 · lead.legal_ok SUPER · /lead · GWAN_PATH · 안심소개 탭 숨김 · 사전 · screens.json · 문서 466 · 467 · 판 v10.335 · 마이그레이션 265
  ② (DB) 꺼진 채 · off 에서 켜기 막힘
  ③ (API) ADMIN 403 · off 에서 노출 422 · on 뒤 노출 → GET /gwans · 되돌림
  ④ (화면) 꺼진 동안 /lead 404
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

M27 = rd('prisma/migrations/D227_lead_gwan_revive/migration.sql')
AS_, LP = rd('src/modules/admin/admin.service.ts'), rd('site/src/app/lead/page.tsx')
FMT, GL = rd('site/src/lib/format.ts'), rd('site/src/components/gwan/GwanLanding.tsx')
SJ = rd('spec/screens.json')
try:
    KO = json.loads(rd('site/src/i18n/messages/ko/consult.json'))['lead']
    EN = json.loads(rd('site/src/i18n/messages/en/consult.json'))['lead']
except Exception:
    KO, EN = {}, {}
try:
    DEF = [x.get('id') for x in json.loads(SJ).get('deferred', [])]
except Exception:
    DEF = ['?']
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D227(지우는 문장 없음 · 꺼진 채) · lead.legal_ok SUPER · /lead 화면(꺼지면 404) · 주소표 LED · 안심소개 상담 탭 숨김 · 사전 · screens.json(이연 5 · 새 화면) · 문서 466 · 467 · 판 v10.335 · 마이그레이션 265',
   "'lead.legal_ok', 'off'" in M27 and 'trg_lead_gwan_guard' in M27 and 'SET is_active = true' not in M27 and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M27)
   and "key === 'lead.legal_ok'" in AS_ and "'LEAD_SETTING_SUPER'" in AS_ and 'notFound()' in LP and "x.code === 'LED'" in LP and 'data-lead-hall' in LP
   and "LED: 'lead'" in FMT and "lead: 'LED'" in FMT and "redirect('/lead')" in GL and KO.get('title') and EN.get('title')
   and len(DEF) == 5 and not any(x in DEF for x in ('SB-ADM-PTN-010', 'SB-PTC-DSH-010')) and '"SB-LED-MAIN-010"' in SJ
   and 'D227' in doc('466_') and 'Q3' in doc('467_') and VT >= (10, 335) and len(mig) >= 265 and 'D227_lead_gwan_revive' in mig,
   f'{VER} · 이연 {len(DEF)} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    stamp = int(time.time()) % 100000
    TAG = f'시험 1335 {stamp}'
    ADM = f't1335adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADM}', '시험1335', '{pw}', now()) ON CONFLICT DO NOTHING")
    adm = psql(f"SELECT id FROM accounts WHERE email = '{ADM}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '{TAG}', true); INSERT INTO account_roles (account_id, role) VALUES ('{adm}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree('admin@x.com', PW); consent_ok.agree(ADM, PW)
    TS, TA = login('admin@x.com'), login(ADM)
    reset = lambda: (psql("UPDATE gwans SET is_active = false WHERE code = 'LED'"), psql("UPDATE site_settings SET value = 'off' WHERE key = 'lead.legal_ok'"))
    try:
        st0 = psql("SELECT (SELECT is_active::text FROM gwans WHERE code = 'LED') || '|' || (SELECT value FROM site_settings WHERE key = 'lead.legal_ok') || '|' || (SELECT name FROM gwans WHERE code = 'LED')")
        bad = psql("UPDATE gwans SET is_active = true WHERE code = 'LED'")
        ok('② DB — LED 꺼진 채 · lead.legal_ok off · 이름 소개리드 · off 에서 켜기 → 트리거가 막음(SETTING:)',
           st0 == 'false|off|소개리드' and '!' in bad and 'lead.legal_ok' in bad, f'{st0} · {bad[-70:]}')
        gw0 = [g.get('code') for g in call('GET', '/gwans') if isinstance(g, dict)]
        na = call('PATCH', '/admin/site-settings', {'key': 'lead.legal_ok', 'value': 'on', 'reason': f'{TAG} ADMIN'}, TA)
        v1 = call('PATCH', '/admin/gwans/LED/visibility', {'isActive': True}, TS)
        s1 = call('PATCH', '/admin/site-settings', {'key': 'lead.legal_ok', 'value': 'on', 'reason': f'{TAG} SUPER'}, TS)
        v2 = call('PATCH', '/admin/gwans/LED/visibility', {'isActive': True}, TS)
        gw1 = [g.get('code') for g in call('GET', '/gwans') if isinstance(g, dict)]
        v3 = call('PATCH', '/admin/gwans/LED/visibility', {'isActive': False}, TS)
        s2 = call('PATCH', '/admin/site-settings', {'key': 'lead.legal_ok', 'value': 'off', 'reason': f'{TAG} 되돌림'}, TS)
        gw2 = [g.get('code') for g in call('GET', '/gwans') if isinstance(g, dict)]
        ok('③ API — 꺼진 동안 GET /gwans 에 LED 없음 · lead.legal_ok ADMIN 403 · off 에서 관 노출 켜기 422 · SUPER 가 on → 켜기 됨 → GET /gwans 에 LED · 끄고 off 로 되돌림',
           'LED' not in gw0 and na.get('_err') == 403 and na.get('code') == 'LEAD_SETTING_SUPER' and v1.get('_err') == 422 and v1.get('code') == 'INVALID_SETTING'
           and '_err' not in s1 and '_err' not in v2 and 'LED' in gw1 and '_err' not in v3 and '_err' not in s2 and 'LED' not in gw2,
           f"{len(gw0)} · {na.get('_err')} {na.get('code')} · {v1.get('_err')} {v1.get('code')} · {s1.get('_err')} · {v2.get('_err')} · LED {'LED' in gw1} · 끔 {'LED' not in gw2}")
        if SITE:
            def run(b, seen, perr):
                ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                r_ = ps.goto(SITE + '/lead', wait_until='networkidle', timeout=120000)
                seen['status'] = r_.status if r_ else None
                seen['hall'] = ps.locator('[data-lead-hall]').count()
                ps.goto(SITE + '/mall?axis=consult', wait_until='networkidle', timeout=120000)
                seen['mallUrl'] = '/mall' in ps.url
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 꺼진 동안 /lead 404 · 안심소개 상담 축 주소는 그대로 안심소개 · 화면 오류 없음',
                   seen.get('status') == 404 and seen.get('hall') == 0 and seen.get('mallUrl') is True and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (SITE 없음 — ④ 건너뜀)')
    finally:
        reset()
        psql(f"BEGIN; SELECT set_config('app.role_reason', '{TAG} 정리', true); DELETE FROM account_roles WHERE account_id = '{adm}' AND role = 'ADMIN'; COMMIT;")
    ok('⑤ 되돌림 — LED 꺼짐 · lead.legal_ok off · 시험 운영자 권한 지움',
       psql("SELECT (SELECT is_active::text FROM gwans WHERE code = 'LED') || '|' || (SELECT value FROM site_settings WHERE key = 'lead.legal_ok')") == 'false|off'
       and psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{adm}' AND role = 'ADMIN'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
