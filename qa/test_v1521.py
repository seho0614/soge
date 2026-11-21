"""v10.521 (D278 · docs/659) 파트너 오픈 API — 파트너별 키(sha256 지문만 · 원문 한 번) · 범위 읽기 3종 · 키마다 1분 한도 · 요청 기록 · 서명 웹훅 · 재시도 · /api/partner/v1 · 처음 꺼짐
  ① (코드) D278 표 · 트리거 · 설정 · 가드 · @Audit 없는 발급 · SSRF 막기 · 컨트롤러 · 정기 작업 · 메뉴 · 화면 OAPI-010 · 문서 도구 패치 · 문서 659
  ② (API · DB) 회원 403 · 꺼짐 503 · 발급(원문 한 번 · 감사에 원문 없음) · 파트너 호출(범위 · 한도 429 · 틀린 키 401) · 요청 기록 · 거두기 · DB 막음 · 웹훅(http 400 · 사설 422 · 둘째 409 · ping → ASSUMED) · 리드 트리거(되돌림) · 권한 주소
  ③ (화면) 파트너사 › 오픈 API
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


def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


import hashlib

# ① 코드
SQL = rd('prisma/migrations/D278_partner_api_bulk_invite_ja_zh/migration.sql')
KS = rd('src/modules/papi/keys.ts'); GD = rd('src/modules/papi/guard.ts'); HK = rd('src/modules/papi/hooks.ts'); RS = rd('src/modules/papi/resources.ts')
PC = rd('src/modules/papi/papi.controller.ts'); AM = rd('src/app.module.ts'); WK = rd('src/worker/worker.controller.ts'); SC = rd('src/worker/scheduler.service.ts')
MN = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx'); W = rd('web/src/app/admin/PartnerOpenApi.tsx')
ok('① D278 — 키(앞머리 · sha256 지문만) · 요청 기록 · 웹훅(암호문 비밀값) · 웹훅 줄 · 리드 트리거(실패해도 배정은 막지 않음) · 설정 5 처음 off · ASSUME · 정기 작업 2',
   all(x in SQL for x in ('CREATE TABLE IF NOT EXISTS public.ptn_api_keys', "key_hash       text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$')", 'CREATE TABLE IF NOT EXISTS public.ptn_api_requests',
       'secret_enc       bytea NOT NULL', 'CREATE TABLE IF NOT EXISTS public.ptn_api_hook_events', 'trg_papi_lead_event', "RAISE WARNING 'papi lead event skipped'",
       "('papi.enabled', 'off'", "('papi.hook_enabled', 'off'", "('papi.hook_mode', 'ASSUME'", "'papi_hook_send', 1,", "'papi_daily', 1440, 3, 50"))
   and 'key_plain' not in SQL and not re.search(r"RAISE [A-Z]+ '[^']*%", SQL), '')
ok('① 가드 — 스위치 · 키 모양 · 지문 고정 시간 비교 · 거둠 · 기한 · 범위 · 1분 한도(429 Retry-After) · 요청 기록(IP 지문 16자)',
   all(x in GD for x in ('PAPI_OFF', 'PAPI_KEY_INVALID', 'PAPI_KEY_REVOKED', 'PAPI_KEY_EXPIRED', 'PAPI_SCOPE', 'PAPI_RATE_LIMIT', "res.setHeader('Retry-After'", 'sameHash(row.hash, keyHash(raw))', 'ip.slice(0, 16)'))
   and 'timingSafeEqual' in KS and "createHash('sha256')" in KS, '')
ok('① 키 원문 · 비밀값 응답 API 에 @Audit 없음(서비스가 원문 없이 남김) · 웹훅 주소 사설 IP 막기 · 보낼 때 DNS 다시(붙는 주소 = 검사한 주소 · lookup) · 넘겨주기 안 따라감 · 비밀값 없으면 안 보냄 · IPv6 예약 범위 · 서명 t.본문',
   all('@Audit(' not in PC[PC.find(a):PC.find(b)] for a, b in (("@Post('papi/keys')", 'issue(@Body()'), ("@Post('papi/hooks')", 'hookNew(@Body()'), ("@Post('papi/hooks/:id/rotate')", 'hookRotate('))) and "papiAudit(db, 'PAPI_KEY_ISSUE', { keyId: row.id, partnerId, company: p.company, prefix: k.prefix" in KS
   and 'privateIp(host)' in KS and 'export function safeLookup' in HK and 'lookup: safeLookup' in HK and 'res.resume()' in HK and 'redirect' not in HK.split('/** 1분마다')[1] and "addrs.some((a) => privateIp(a.address))" in HK and 'ERR_NO_SECRET' in HK and "'64:ff9b::', 96" in KS and "'2002::', 16" in KS and "update(`${t}.${raw}`)" in HK and 'BACKOFF_MIN = [1, 5, 30, 120, 360, 720]' in HK, '')
ok('① 파트너 주소 /api/partner/v1 · @UseGuards(PartnerApiKeyGuard) · 연락처 칸 없음 · 컨트롤러 4 등록 · 정기 작업 연결 · 메뉴 · 화면',
   "@Controller('api/partner/v1')\n@UseGuards(PartnerApiKeyGuard)" in PC and 'lead_contacts' not in RS and 'fn_read_lead_contact' not in RS
   and all(x in AM for x in ('PapiAdminController,', 'PbulkAdminController,', 'PapiPartnerController,', 'I18nReviewController,'))
   and all(f"'{j}'" in WK for j in ('papi_hook_send', 'papi_daily', 'pbulk_match')) and "case 'papi_hook_send':" in SC
   and "['ptn-openapi', '오픈 API']" in MN and "'partner-axes', 'directory', 'ptn-openapi', 'ptn-bulk'" in MN and "{tab === 'ptn-openapi' && <PtnOpenApi />}" in APP
   and 'data-papi-issue' in W and 'data-papi-once' in W, '')
scr = {x['id']: x for x in json.loads(SJ or '{"screens":[]}')['screens']}
o1 = scr.get('SB-ADM-OAPI-010', {})
ok('① 화면 SB-ADM-OAPI-010 — 운영 API 13 + 파트너 API 6(/api/partner/v1 그대로) · 문서 도구가 「/api/」 주소를 그대로 씀',
   len(o1.get('apis', [])) == 19 and sum(1 for a in o1.get('apis', []) if ' /api/partner/v1/' in a) == 6
   and "rawPath.startsWith('/api/') ? '' : '/api/v1'" in rd('scripts/gen-docs.js') and "p.startsWith('/api/')?'':'/api/v1'" in rd('scripts/verify-docs.js'), str(len(o1.get('apis', []))))
D659 = doc('659_')
ok('① 문서 659 — 보안 검토 · 처리방침 고칠 곳 · 법무 확인 · 서명 확인 예시', all(x in D659 for x in ('보안 검토', '처리방침 고칠 곳', '법무 확인', 'X-Sgb-Signature')), '')
ok('① 판 v10.521 이상', VT >= (10, 521), VER)

PAPI = API.replace('/api/v1', '/api/partner/v1')


def pcall(path, key=None, hdr=None):
    hd = dict(hdr or {})
    if key:
        hd['X-Partner-Key'] = key
    r = urllib.request.Request(PAPI + path, headers=hd, method='GET')
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return 200, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return e.code, bd


if API and DB:
    TAG = 'v1521-' + str(int(time.time()))
    keys, hooks = [], []
    old = {k: getset(k) for k in ('papi.enabled', 'papi.hook_enabled', 'papi.hook_mode')}
    pid = psql("SELECT id FROM partners WHERE status = 'ACTIVE' ORDER BY applied_at LIMIT 1")
    if not re.match(r'^[0-9a-f-]{36}$', pid or ''):
        print('  (활동 중 파트너 없음 — ② 건너뜀)')
    else:
        try:
            TS, TB = login('admin@x.com'), login('buyer@x.com')
            mb = call('GET', '/admin/papi', t=TB)
            setting('papi.enabled', 'off', TAG)
            time.sleep(11)
            off_s, off_b = pcall('/me', 'sgbp_aaaaaaaa_' + 'a' * 32)
            setting('papi.enabled', 'on', TAG)
            for _ in range(15):
                st, _b = pcall('/me', 'sgbp_aaaaaaaa_' + 'a' * 32)
                if st != 503:
                    break
                time.sleep(2)
            bad_scope = call('POST', '/admin/papi/keys', {'partnerId': pid, 'name': '시험 ' + TAG, 'scopes': ['leads:write']}, TS)
            iss = call('POST', '/admin/papi/keys', {'partnerId': pid, 'name': '시험 ' + TAG, 'scopes': ['leads:read'], 'ratePerMin': 2, 'days': 1}, TS)
            key = iss.get('key') or ''
            if iss.get('id'):
                keys.append(iss['id'])
            sha = hashlib.sha256(key.encode()).hexdigest()
            dbk = psql(f"SELECT count(*) FROM ptn_api_keys WHERE key_hash = '{sha}' AND key_prefix = '{key[:13]}'")
            leak = psql(f"SELECT count(*) FROM audit.audit_logs WHERE occurred_at > now() - interval '10 minutes' AND after_data::text LIKE '%{key[14:]}%'") if len(key) > 20 else '?'
            ok('② 회원 403 · 꺼짐 503 PAPI_OFF · 범위 틀림 400 · 발급(원문 한 번 · 모양 · DB 지문만 · 감사 기록에 원문 없음)',
               mb.get('_err') == 403 and off_s == 503 and off_b.get('code') == 'PAPI_OFF' and bad_scope.get('_err') == 400
               and re.match(r'^sgbp_[a-z0-9]{8}_[A-Za-z0-9_-]{32}$', key) and dbk == '1' and leak == '0',
               f"{mb.get('_err')} {off_s} {off_b.get('code')} {bad_scope.get('_err')} {key[:13]} {dbk} {leak}")
            me_s, me = pcall('/me', key)
            ld_s, ld = pcall('/leads?limit=5', key)
            sv_s, sv = pcall('/services', key)
            hits = [pcall('/me', key)[0] for _ in range(5)]
            inv_s, inv = pcall('/me', 'not-a-key')
            wrong_s, wrong = pcall('/me', key[:14] + ('A' if key[14:15] != 'A' else 'B') + key[15:])
            ok('② 파트너 호출 — me 200(범위) · leads 200(연락처 칸 없음) · 범위 밖 403 PAPI_SCOPE · 1분 한도 429 · 모양 틀림 · 비밀 틀림 401',
               me_s == 200 and me.get('key', {}).get('scopes') == ['leads:read'] and ld_s == 200 and isinstance(ld.get('items'), list)
               and not any('phone' in x or 'contact' in x for x in ld.get('items', [])) and sv_s == 403 and sv.get('code') == 'PAPI_SCOPE'
               and 429 in hits and inv_s == 401 and inv.get('code') == 'PAPI_KEY_INVALID' and wrong_s == 401 and wrong.get('code') == 'PAPI_KEY_INVALID',
               f"{me_s} {ld_s} {sv_s} {sv.get('code')} {hits} {inv_s} {wrong_s}")
            time.sleep(1)
            nlog = psql(f"SELECT count(*) || '|' || count(*) FILTER (WHERE ip_key IS NULL OR length(ip_key) = 16) || '|' || count(*) FILTER (WHERE status = 429) FROM ptn_api_requests WHERE key_id = {int(keys[0]) if keys else 0}")
            rv = call('POST', f"/admin/papi/keys/{keys[0] if keys else 0}/revoke", {'reason': '시험 거둠 ' + TAG}, TS)
            rv2 = call('POST', f"/admin/papi/keys/{keys[0] if keys else 0}/revoke", {'reason': '시험 거둠 ' + TAG}, TS)
            rv_s, rvb = pcall('/me', key)
            dbup = psql(f"UPDATE ptn_api_keys SET status = 'ACTIVE', revoked_at = NULL WHERE id = {int(keys[0]) if keys else 0}")
            dbdel = psql(f"DELETE FROM ptn_api_keys WHERE id = {int(keys[0]) if keys else 0}")
            n_, a_, r429 = (nlog.split('|') + ['0', '0', '0'])[:3]
            ok('② 요청 기록(막힌 것 포함 · IP 지문만) · 거두기 · 다시 409 · 거둔 키 401 PAPI_KEY_REVOKED · DB 가 되살리기 · 지우기 막음',
               int(n_) >= 7 and n_ == a_ and int(r429) >= 1 and rv.get('ok') and rv2.get('_err') == 409 and rv_s == 401 and rvb.get('code') == 'PAPI_KEY_REVOKED'
               and 'PAPI_KEY' in dbup and 'PAPI_KEY' in dbdel, f"{nlog} {rv.get('ok')} {rv2.get('_err')} {rv_s} {rvb.get('code')} {dbup[-40:]} {dbdel[-40:]}")
            h_http = call('POST', '/admin/papi/hooks', {'partnerId': pid, 'url': 'http://partner.example.com/h', 'events': ['lead.delivered']}, TS)
            h_loc = call('POST', '/admin/papi/hooks', {'partnerId': pid, 'url': 'https://127.0.0.1/h', 'events': ['lead.delivered']}, TS)
            psql(f"SET session_replication_role = replica; UPDATE ptn_api_hooks SET status = 'DISABLED', disabled_at = now(), disabled_reason = '시험 앞 정리' WHERE partner_id = '{pid}' AND status = 'ACTIVE' AND url LIKE 'https://partner.example.com/sgb-test%';")
            had = psql(f"SELECT count(*) FROM ptn_api_hooks WHERE partner_id = '{pid}' AND status = 'ACTIVE'")
            if had == '0':
                hk = call('POST', '/admin/papi/hooks', {'partnerId': pid, 'url': 'https://partner.example.com/sgb-test/' + TAG, 'events': ['lead.delivered', 'lead.state_changed']}, TS)
                if hk.get('id'):
                    hooks.append(hk['id'])
                hk2 = call('POST', '/admin/papi/hooks', {'partnerId': pid, 'url': 'https://partner.example.com/sgb-test/2', 'events': ['lead.delivered']}, TS)
                sec = hk.get('secret') or ''
                last4 = psql(f"SELECT secret_last4 FROM ptn_api_hooks WHERE id = {int(hooks[0]) if hooks else 0}")
                setting('papi.hook_enabled', 'on', TAG); setting('papi.hook_mode', 'ASSUME', TAG)
                pg = call('POST', f"/admin/papi/hooks/{hooks[0] if hooks else 0}/test", None, TS)
                run = call('POST', '/admin/papi/run', None, TS)
                est = psql(f"SELECT state FROM ptn_api_hook_events WHERE id = {int(pg.get('id') or 0)}")
                ok('② 웹훅 — http 400 · 사설 IP 422 · 만들기(비밀값 한 번 · 끝 4자만 DB) · 둘째 409 · 시험 줄 → 지금 보내기(ASSUME) → ASSUMED',
                   h_http.get('_err') == 400 and h_loc.get('_err') == 422 and h_loc.get('code') == 'PAPI_HOOK_URL' and sec.startswith('whsec_') and len(sec) == 38
                   and last4 == sec[-4:] and hk2.get('_err') == 409 and run.get('on') is True and int(run.get('assumed') or 0) >= 1 and est == 'ASSUMED',
                   f"{h_http.get('_err')} {h_loc.get('code')} {sec[:6]} {last4} {hk2.get('_err')} {run} {est}")
                lead = psql(f"SELECT l.id FROM leads l WHERE NOT EXISTS (SELECT 1 FROM lead_deliveries d WHERE d.lead_id = l.id AND d.partner_id = '{pid}') LIMIT 1")
                if re.match(r'^[0-9a-f-]{36}$', lead or ''):
                    out = psql(f"BEGIN; INSERT INTO lead_deliveries (lead_id, partner_id) VALUES ('{lead}', '{pid}'); "
                               f"SELECT count(*) FROM ptn_api_hook_events WHERE hook_id = {int(hooks[0]) if hooks else 0} AND event = 'lead.delivered'; ROLLBACK;")
                    if '!' in out:
                        print('  (시험 배정 넣기가 다른 규칙에 막힘 — 리드 트리거 단언 건너뜀)', out[-80:])
                    else:
                        ok('② 리드 배정(트랜잭션 안 · 되돌림) → 웹훅 줄 lead.delivered 1', out.splitlines()[-1].strip() == '1', out[-40:])
                else:
                    print('  (배정할 리드 없음 — 리드 트리거 단언 건너뜀)')
            else:
                print('  (그 파트너에 살아 있는 웹훅이 이미 있음 — 웹훅 단언 건너뜀)')
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'ptn-openapi'")
            ok('② 권한 주소 13(ptn-openapi)', rmap == '13', rmap)
        finally:
            for k_, v_ in old.items():
                if v_ != '':
                    setting(k_, v_, TAG)
            for h in hooks:
                psql(f"SET session_replication_role = replica; DELETE FROM ptn_api_hook_events WHERE hook_id = {int(h)}; DELETE FROM ptn_api_hooks WHERE id = {int(h)};")
            for k in keys:
                psql(f"SET session_replication_role = replica; DELETE FROM ptn_api_requests WHERE key_id = {int(k)}; DELETE FROM ptn_api_keys WHERE id = {int(k)};")
    if ADMIN_WEB:
        r = admin_page('/#/ptn-openapi', lambda pg, seen: seen.update(n=pg.locator('[data-papi]').count(), issue=pg.locator('[data-papi-issue]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 파트너사 › 오픈 API(발급 상자 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('issue') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
