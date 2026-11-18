"""v10.356 (D235 · docs/490) 감사 기록 위변조 확인 — SHA-256 사슬
  ① (코드) D235 · 트리거 순서 · 막기 · 확인 함수 · 정기 작업 · 알림 · API · 화면 · 문서 490 · 판 v10.356 · 마이그레이션 273
  ② (DB) 새 줄 사슬 · 연결 · 사슬 칸 고치기 막힘
  ③ (확인) 온전 · 고친 줄 잡음 · 되돌리면 온전
  ④ (API · 화면) 상태 · 지금 확인 · 403 · 상자
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

M26 = rd('prisma/migrations/D226_faq_feedback_inquiry_templates/migration.sql')
FB, TC = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/support/inquiry-template.controller.ts')
FS, AM = rd('src/modules/help/faq-admin.service.ts'), rd('src/app.module.ts')
HUB, FA, DESK = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
SJ = rd('spec/screens.json')

M35, SR, SRC, SC = rd('prisma/migrations/D235_audit_chain_security_monthly/migration.sql'), rd('src/modules/admin/security-report.ts'), rd('src/modules/admin/security-report.controller.ts'), rd('src/worker/scheduler.service.ts')
SB, AU, OA = rd('web/src/app/admin/SecurityBoxes.tsx'), rd('web/src/app/admin/Audit.tsx'), rd('web/src/app/admin/OpsAlerts.tsx')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D235 사슬 칸 셋 · 트리거 trg_zz(가림 트리거 뒤) · 거래 잠금 · IP · UA 지문 밖 · 사슬 칸도 막음 · 확인 기록(쌓기만) · 확인 함수 · 지우는 문장 없음 · 정기 작업 · 급한 알림 · API · 화면 · 문서 490 · 판 v10.356 · 마이그레이션 273',
   'ADD COLUMN IF NOT EXISTS chain_hash text' in M35 and "tgname = 'trg_zz_audit_chain'" in M35 and 'pg_advisory_xact_lock(7426001)' in M35
   and 'host(r.ip)' not in M35 and 'OR NEW.chain_hash        IS DISTINCT FROM OLD.chain_hash' in M35 and 'trg_audit_chain_checks_ro' in M35
   and 'CREATE OR REPLACE FUNCTION audit.fn_audit_chain_verify' in M35 and not re.search(r'\b(DROP|DELETE FROM|TRUNCATE)\b', M35)
   and 'export async function auditChainCheck' in SR and "'AUDIT_CHAIN_BROKEN', 'CRITICAL'" in SC and "@Post('audit-chain/check')" in SRC
   and '<AuditChainBox />' in AU and 'AUDIT_CHAIN_BROKEN:' in OA and 'D235' in doc('490_') and VT >= (10, 356) and len(mig) >= 273 and 'D235_audit_chain_security_monthly' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    ADM = f't1356adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'admin@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADM}', '시험1356', '{pw}', now()) ON CONFLICT DO NOTHING")
    adm = psql(f"SELECT id FROM accounts WHERE email = '{ADM}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1356', true); INSERT INTO account_roles (account_id, role) VALUES ('{adm}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(ADM, PW)
    TA = login(ADM)
    try:
        base = psql("SELECT coalesce(max(chain_seq), 0) FROM audit.audit_logs")
        bh = psql(f"SELECT coalesce(chain_hash, '') FROM audit.audit_logs WHERE chain_seq = {base}") if base != '0' else ''
        psql(f"""INSERT INTO audit.audit_logs (action, target_type, after_data) VALUES ('TESTCHAIN_1356', 'TEST', '{{"n": 1, "s": "{stamp}"}}'::jsonb)""")
        psql(f"""INSERT INTO audit.audit_logs (action, target_type, after_data, ip) VALUES ('TESTCHAIN_1356', 'TEST', '{{"n": 2, "s": "{stamp}"}}'::jsonb, '10.0.0.1')""")
        rows = psql(f"SELECT id || '|' || chain_seq || '|' || coalesce(chain_prev::text, '-') || '|' || length(chain_hash) FROM audit.audit_logs WHERE action = 'TESTCHAIN_1356' AND after_data->>'s' = '{stamp}' ORDER BY chain_seq").split('\n')
        r1, r2 = (rows + ['', ''])[0].split('|'), (rows + ['', ''])[1].split('|')
        up = psql(f"UPDATE audit.audit_logs SET chain_hash = 'x' WHERE id = {r2[0] if r2[0] else 0}")
        ok('② DB — 새 감사 줄 둘에 사슬(순번 · 앞 줄 연결 · 지문 64자) · 둘째는 첫째에 이어짐 · 사슬 칸 고치기 막힘',
           len(rows) == 2 and r1[3] == '64' and r2[3] == '64' and r2[2] == r1[0] and int(r2[1]) > int(r1[1]) and '!' in up and 'append-only' in up, f'{rows} · {up[-80:]}')
        vf = lambda: psql(f"SELECT ok || '|' || coalesce(broken_id::text, '-') || '|' || checked FROM audit.fn_audit_chain_verify({base if base != '0' else 'NULL'}::bigint, {repr(bh) if bh else 'NULL'}::text)")
        v1 = vf()
        orig = psql(f"SELECT after_data::text FROM audit.audit_logs WHERE id = {r2[0]}")
        psql(f"""SET session_replication_role = replica; UPDATE audit.audit_logs SET after_data = '{{"n": 99}}'::jsonb WHERE id = {r2[0]}""")
        v2 = vf()
        psql(f"SET session_replication_role = replica; UPDATE audit.audit_logs SET after_data = '{orig}'::jsonb WHERE id = {r2[0]}")
        v3 = vf()
        mk_ = psql(f"UPDATE audit.audit_logs SET ip = NULL, user_agent = NULL WHERE id = {r2[0]}")
        v4 = vf()
        ok('③ 확인 — 시험 시작 지점부터 온전 · 시험 줄 내용을 몰래 바꾸면 그 줄에서 끊김 · 되돌리면 온전 · IP 마스킹은 지문과 상관없음(온전)',
           v1.startswith('t|-|') and v2.startswith(f'f|{r2[0]}|') and v3.startswith('t|-|') and '!' not in mk_ and v4.startswith('t|-|'), f'{v1} · {v2} · {v3} · {v4}')
        st = call('GET', '/admin/security/audit-chain', None, TS)
        ck = call('POST', '/admin/security/audit-chain/check', None, TS)
        st2 = call('GET', '/admin/security/audit-chain', None, TS)
        fa = call('POST', '/admin/security/audit-chain/check', None, TA)
        sa = call('GET', '/admin/security/audit-chain', None, TA)
        ok('④ API — 상태(사슬 줄 · 사슬 전 줄) · 지금 확인(SUPER) 온전 · 마지막 확인 갱신 · ADMIN 읽기는 되고 지금 확인은 403',
           int(st.get('chained') or 0) >= 2 and isinstance(st.get('before'), int) and ck.get('ok') is True and (st2.get('last') or {}).get('ok') is True
           and fa.get('_err') == 403 and sa.get('_err') is None, f"{st.get('chained')} {st.get('before')} · {ck} · {(st2.get('last') or {})} · {fa.get('_err')} {sa.get('_err')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/gov-audit', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['state'] = pg.locator('[data-audit-chain]').get_attribute('data-audit-chain') if pg.locator('[data-audit-chain]').count() else None
                if pg.locator('[data-sec-monthly-toggle]').count():
                    pg.locator('[data-sec-monthly-toggle]').click(); pg.wait_for_timeout(2000)
                seen['monthly'] = '월간 보안 보고' in (pg.locator('[data-sec-monthly]').inner_text() if pg.locator('[data-sec-monthly]').count() else '')
                pg.screenshot(path=os.path.join(HERE, 'v1356_chain.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ⑤ 건너뜀)')
            else:
                seen, perr = r
                ok('⑤ 화면 — 위험감지 › 감사 › 「감사 기록 위변조 확인 — 사슬 온전」 · 「월간 보안 보고 미리 보기」 글 · 화면 오류 없음',
                   seen.get('state') == 'ok' and seen.get('monthly') and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ⑤ 건너뜀)')
    finally:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1356 지움', true); DELETE FROM account_roles WHERE account_id = '{adm}'; COMMIT;")
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
