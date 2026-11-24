"""v10.786 (docs/895) — 간주 끄기 리허설 「끄면 달라지는 것」 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1786.py

  ① (코드) assumeRehearsal 읽기만 · registry 어댑터 · 화면 펼침 · 문서 895 · 판
  ② (API) 4줄 rehearsal · 어댑터 REAL · 건수 = DB · 경고
  ③ (화면) 오픈 체크리스트 줄마다 펼침 · 결제 줄 어댑터 · 기록 5줄
  (읽기만 — 두 번 돌아도 통과)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API')
DB = os.environ.get('DB')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
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


def _unused_admin_account(tag, stamp):
    """ADMIN(최고 관리자 아님) 시험 계정 — 남겨 두어도 두 번째 실행에 지장 없음"""
    import consent_ok
    em = f't{tag}adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(em, PW)
    return em, aid


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')



AS, AC, AR, D895 = rd('src/modules/admin/admin.service.ts'), rd('src/modules/admin/admin.controller.ts'), rd('web/src/app/admin/AssumeReadiness.tsx'), doc('895_')
SEG = AS[AS.find('private async assumeRehearsal()'):AS.find('  openBlockers() {')]
ok('① 서버 — assumeRehearsal 읽기만(UPDATE · INSERT · DELETE 없음) · 어댑터는 registry INTEGRATIONS · 줄마다 rehearsal · 세금계산서 표 이름 검사',
   'rehearsal: rehearsal[r.key]' in AS and "import { INTEGRATIONS } from '../../common/integration/registry'" in AS and len(SEG) > 500
   and not re.search(r"\b(UPDATE|INSERT|DELETE)\b", SEG) and "/^[a-z0-9_]+$/.test(x.t)" in SEG and 'v_broker_verified_assumed' in SEG
   and "submerchant_id LIKE 'STUB-SUB-%'" in SEG and 'subscription_invoices WHERE is_stub' in SEG and 'v10.786' in AC, str(len(SEG)))
ok('① 화면 — 줄마다 「끄면 달라지는 것」 펼침(details) · 어댑터 · 경고 · 기록 · 끈 뒤 할 일 · 새 메뉴 없음',
   '<RehearsalView k={r.key} h={r.rehearsal} />' in AR and 'data-assume-rehearsal={k}' in AR and 'data-rehearsal-adapter' in AR and '끈 뒤 할 일' in AR
   and 'AssumeRehearsal' not in rd('web/src/lib/adminMenu.ts'), '')
ok('① 문서 895 · 판 v10.786', all(w in D895 for w in ('끄면 달라지는 것', '기존 상자', 'REAL', 'STUB'))  and VT >= (10, 786), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    r = call('GET', '/admin/assume-readiness', None, TS)
    rows = r.get('rows') or []
    by = {x.get('key'): x for x in rows}
    hs = {k: (by.get(k) or {}).get('rehearsal') or {} for k in ('assume.bank', 'assume.broker', 'assume.etax', 'assume.payment')}
    raw = json.dumps(r, ensure_ascii=False)
    ok('② API — 4줄 모두 rehearsal · 어댑터(BROKER · ETAX · PG REAL · 수금 계좌는 없음) · 바뀌는 동작 · 끈 뒤 할 일 · 기록은 숫자',
       len(rows) == 4 and all(isinstance(h.get('records'), list) and h.get('changes') and h.get('after') for h in hs.values())
       and hs['assume.bank'].get('adapter') is None and [ (hs[k].get('adapter') or {}).get('code') for k in ('assume.broker', 'assume.etax', 'assume.payment')] == ['BROKER', 'ETAX', 'PG']
       and all((hs[k].get('adapter') or {}).get('adapter') == 'REAL' for k in ('assume.broker', 'assume.etax', 'assume.payment'))
       and all(isinstance(x.get('n'), int) and x['n'] >= 0 for h in hs.values() for x in h.get('records', [])), json.dumps(hs, ensure_ascii=False)[:600])
    nb = psql("SELECT count(*) FROM v_broker_verified_assumed")
    ns = psql("SELECT count(*) FROM subscription_invoices WHERE is_stub")
    rb = {x['label']: x['n'] for x in hs['assume.broker'].get('records', [])}
    rp = {x['label']: x['n'] for x in hs['assume.payment'].get('records', [])}
    ok('② 건수 = DB(중개사 재대조 대상 · 구독 시험 결제) · 세금계산서 표가 1개 이상 · 결제 경고(하위가맹점 계약 뒤)',
       list(rb.values()) == [int(nb)] and next((v for k, v in rp.items() if 'subscription_invoices' in k), -1) == int(ns)
       and len(hs['assume.etax'].get('records', [])) >= 1 and any('계약 뒤' in w for w in hs['assume.payment'].get('warn', [])), f'broker {rb} db {nb} · sub db {ns} · etax {hs["assume.etax"].get("records")}')
    integ = {x.split('|')[0]: x.split('|')[1] for x in psql("SELECT code || '|' || status FROM integrations WHERE code IN ('PG', 'BROKER', 'ETAX')").splitlines() if '|' in x}
    ok('② 외부 연동이 시험 중 · 연결됨이 아니면 경고 줄 · 키 · 주소 값 없음',
       all((integ.get(c) in ('TESTING', 'LIVE')) or any('서버가 끄기를 막음' in w for w in hs[k].get('warn', [])) for k, c in (('assume.broker', 'BROKER'), ('assume.etax', 'ETAX'), ('assume.payment', 'PG')))
       and 'sk_' not in raw and 'http://' not in raw and 'https://' not in raw, f'{integ}')
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        seen = {}
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/checklist', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                dl = pg.locator('[data-assume-rehearsal]')
                seen['keys'] = [x.get_attribute('data-assume-rehearsal') for x in dl.all()]
                if dl.count():
                    pay = pg.locator('[data-assume-rehearsal="assume.payment"]')
                    pay.locator('summary').click(); pg.wait_for_timeout(500)
                    seen['open'] = pay.evaluate('e => e.open')
                    seen['adapter'] = pay.locator('[data-rehearsal-adapter]').get_attribute('data-rehearsal-adapter') if pay.locator('[data-rehearsal-adapter]').count() else None
                    seen['recs'] = pay.locator('[data-rehearsal-rec]').count()
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        ok('③ 화면 — 오픈 체크리스트 간주 4줄마다 「끄면 달라지는 것」 · 결제 줄 펼침 · 어댑터 PG:REAL · 기록 5줄',
           seen.get('keys') == ['assume.bank', 'assume.broker', 'assume.etax', 'assume.payment'] and seen.get('open') is True
           and seen.get('adapter') == 'PG:REAL' and seen.get('recs') == 5, f'{seen}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
