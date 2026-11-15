"""v10.318 (docs/443) — 게시 확인 창에 게시 준비 요약 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1318.py

  ① (코드) 게시 응답 readyCheck · 감사 TERM_PUBLISH 에 남음 · 서버는 막지 않음 · 확인 창 「게시 준비 — 아직 n」 · 「아직」이면 「게시」 입력 · 문서 443 · 판 v10.318
  ② (화면) 시험 약관(T1318 · 필수 아님) — 게시 준비를 「아직 1」로 바꿔 보여 줌(브라우저 길 가로채기) → 확인 창에 요약 · 입력 창에서 취소 → 게시 안 됨
  ③ (API) 같은 약관 게시 → readyCheck(ready · todo · info) · 감사 기록 after_data 에 readyCheck · 시험 약관 지움
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
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


def admin_account(tag, stamp):
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


TS_, TD, TP, D443 = rd('src/modules/catalog/terms.service.ts'), rd('src/modules/catalog/terms.dto.ts'), rd('web/src/app/admin/TermsPanel.tsx'), doc('443_')
ok('① 서버 — 게시 때 publishReady 를 한 번 셈 → readyCheck(ready · todo 이름 · info 수) 응답(감사 after_data) · 막지 않음 · DTO',
   'const rd = await this.publishReady(code, dto.version);' in TS_ and 'remainingBlockers: Number(n.c), readyCheck };' in TS_
   and "todo: rd.items.filter((x) => x.state === 'todo').map((x) => x.label)" in TS_ and 'readyCheck?: { ready: boolean; todo: string[]; info: number };' in TD
   and "PolicyViolation('READY" not in TS_, '')
ok('① 화면 · 문서 — 확인 창 「게시 준비 — 아직 n · 알아 둘 것 n · 됨 n」 · ✗ 줄 · 「아직」이면 「게시」 입력(아니면 게시 안 함) · 결과 줄 · 문서 443 · 판 v10.318',
   '게시 준비 — 아직 ${todo.length}' in TP and "그래도 게시하려면 「게시」라고 입력하십시오." in TP and ".trim() !== '게시'" in TP and '인 채로 게시함(감사 기록에 남음)' in TP
   and '게시 준비' in D443 and VT >= (10, 318), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    C, V = 'T1318', '1.0'
    today = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')")
    clean = lambda: psql(f"DELETE FROM terms WHERE code = '{C}'")
    clean()
    ins = psql(f"INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('{C}', '{V}', '시험 약관 1318', E'## 제1조 시험\\n본문', false, 'infinity', 'LEGAL_REVIEW')")
    try:
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if ADMIN_WEB and sync_playwright:
            seen = {'msgs': []}
            fake = {'code': C, 'version': V, 'title': '시험 약관 1318', 'first': True, 'current': None, 'ready': False, 'after': [],
                    'items': [{'key': 'legal', 'label': '법무 회신', 'state': 'todo', 'text': '고쳐야 함 1건 — 시험'},
                              {'key': 'date', 'label': '시행일', 'state': 'info', 'text': '시험'}]}
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    def on_dialog(d):
                        seen['msgs'].append((d.type, d.message))
                        d.accept() if d.type == 'confirm' else d.dismiss()
                    pg.on('dialog', on_dialog)
                    pg.route(f'**/admin/terms/{C}/publish-ready**', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(fake, ensure_ascii=False)))
                    pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    pg.fill('[data-terms-date]', today); pg.wait_for_timeout(300)
                    pg.locator(f'[data-term-row="{C}:{V}"] [data-term-publish]').click(); pg.wait_for_timeout(2500)
                    r_ = pg.locator('[data-terms-result]')
                    seen['result'] = (r_.get_attribute('data-terms-result'), r_.inner_text()) if r_.count() else None
                    b.close()
            except Exception as e:
                seen['err'] = str(e)[:200]
            st = psql(f"SELECT status FROM terms WHERE code = '{C}' AND version = '{V}'")
            cf = next((m for t, m in seen['msgs'] if t == 'confirm'), '')
            pr = next((m for t, m in seen['msgs'] if t == 'prompt'), '')
            ok('② 화면 — 확인 창에 「게시 준비 — 아직 1 · 알아 둘 것 1」 · ✗ 법무 회신 줄 → 입력 창 「「게시」라고 입력」 → 취소 → 「게시하지 않았습니다」 · 약관은 그대로(LEGAL_REVIEW)',
               ins == '' and '게시 준비 — 아직 1 · 알아 둘 것 1' in cf and '✗ 법무 회신' in cf and '「게시」라고 입력' in pr
               and (seen.get('result') or ('', ''))[0] == 'fail' and '게시하지 않았습니다' in (seen.get('result') or ('', ''))[1] and st == 'LEGAL_REVIEW',
               f"ins {ins[:60]} · {[(t, m[:50]) for t, m in seen['msgs']]} · {seen.get('result')} · {st} · {seen.get('err', '')}")
        else:
            print('  (운영 화면 · playwright 없음 — ② 건너뜀)')
        r = call('PATCH', f'/admin/terms/{C}/publish', {'version': V, 'effectiveFrom': today}, TS)
        rc = r.get('readyCheck') or {}
        time.sleep(1)
        au = psql(f"SELECT after_data -> 'readyCheck' ->> 'ready' FROM audit.audit_logs WHERE action = 'TERM_PUBLISH' AND after_data ->> 'code' = '{C}' AND occurred_at > now() - interval '10 minutes' ORDER BY occurred_at DESC LIMIT 1")
        ok('③ API — 시험 약관 게시 → readyCheck(ready true · todo 없음 · info ≥ 1) · 감사 TERM_PUBLISH after_data 에 readyCheck',
           r.get('status') == 'PUBLISHED' and rc.get('ready') is True and rc.get('todo') == [] and (rc.get('info') or 0) >= 1 and au == 'true',
           f"{r.get('status')} {r.get('_err')} {r.get('message')} · {rc} · 감사 {au}")
    finally:
        clean()
    ok('③ 지움 — 시험 약관 T1318 없음', psql(f"SELECT count(*) FROM terms WHERE code = '{C}'") == '0', '')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
