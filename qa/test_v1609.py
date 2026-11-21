"""v10.609 (docs/751) ㉕ 파트너 계약 갱신 알림 · 재서명 — 파트너사 › 파트너 계약 갱신(bzx-ptn-contract) · 파트너센터 › 계약(/partner/contracts)
  ① (코드) 기존 ESIGN 어댑터 재사용 · 간주 스위치 · 지문 · 만기 알림 · 컨트롤러 · 정기 작업 bzx_daily · 화면 · 메뉴 · 화면 목록 · SQL · 문서 751 · 판
  ② (API · DB) 종이 계약 → 만기 알림 한 줄(두 번 돌려도) · 갱신 보내기(간주) · 같은 갱신 409 · DB 본문 고치기 막음 · 파트너 대표 서명(다른 이름 422 · 동의 없음 422) · 옛 알림 풀림 · 만기 지남 EXPIRED · 알림
  ③ (화면) 파트너 계약 갱신 탭 · 줄 · 보내기 상자
  (두 번 돌아도 통과 — 「시험1609-」 계약 · 알림은 시작 · 끝에 replica 로 지움 · 설정은 되돌림)
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


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''



def migr_has(text):
    """18차 SQL 은 메인이 마이그레이션 번호를 붙임(D292 ~) — 번호 없이 모든 마이그레이션에서 글자를 찾음"""
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return False
    for x in sorted(os.listdir(d)):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p) and text in open(p, encoding='utf-8').read():
            return True
    return False


def job(name, tok):
    return call('POST', '/admin/jobs', {'job': name}, tok)


STAMP = int(time.time()) % 1000000
KST = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
TODAY = KST.strftime('%Y-%m-%d')
def day(n):
    return (KST + datetime.timedelta(days=n)).strftime('%Y-%m-%d')


"""시험 몸통"""
PC, CT, JB = rd('src/modules/bzx/partner-contract.ts'), rd('src/modules/bzx/bzx.controller.ts'), rd('src/modules/bzx/jobs.ts')
UI, AP, MN = rd('web/src/app/admin/Bzx.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SC, WC, AM = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
SP, SPP = rd('site/src/components/bzx/PartnerContracts.tsx'), rd('site/src/app/partner/contracts/page.tsx')
ok('① 코드 — partner-contract.ts 기존 ESIGN 어댑터 재사용(HttpESign · EsignService.readMode) · 간주 스위치 · 지문 · 만기 알림 · 컨트롤러 · 정기 작업 bzx_daily',
   all(f in PC for f in ('export async function pcCreate', 'export async function pcSign', 'export async function pcDailyJob', 'new HttpESign().create(', 'EsignService.readMode(',
                          "'bzx.partner_esign'", "'BZX_PARTNER_RENEW'", "'BZX_PARTNER_EXPIRED'", "'BZX_PARTNER_UNSIGNED'", "code = 'PARTNER_STD'", 'NOT_READY'))
   and "@Controller('api/v1/admin/bzx')" in CT and "@Controller('api/v1/partner/bzx')" in CT and "@Post('contracts/:id/sign')" in CT and "@Roles('ADMIN', 'SUPER', 'PARTNER_MAL')" in CT
   and 'pcDailyJob(db)' in JB and "case 'bzx_daily'" in SC and "'bzx_daily'," in WC and 'BzxPartnerController' in AM,
   f"{len(PC)} {len(CT)}")
ok('① 화면 — 운영 탭 bzx-ptn-contract(메뉴 · PAGE · 역할) · 파트너센터 /partner/contracts(SB-PTC-BZX-010) · 화면 목록 · SQL · 문서 751 · 판',
   'export function BzxPartnerContracts' in UI and "['bzx-ptn-contract', '파트너 계약 갱신']" in MN and "screen: 'SB-ADM-BZX-010'" in MN
   and "'bzx-ptn-contract': ['ADMIN', 'SUPER', 'PARTNER_MAL']" in AP and "<BzxPartnerContracts />" in AP
   and '/api/v1/partner/bzx/contracts' in SP and 'data-screen="SB-PTC-BZX-010"' in SPP and '"SB-ADM-BZX-010"' in SJ and '"SB-PTC-BZX-010"' in SJ
   and migr_has('CREATE TABLE IF NOT EXISTS public.bzx_partner_contracts') and migr_has("('bzx-ptn-contract', '파트너 계약 갱신', 'admptn'")
   and '간주' in doc('751_') and VT >= (10, 609), VER)

CLEAN = ("SET session_replication_role = replica; "
         "DELETE FROM ops_alerts WHERE alert_code LIKE 'BZX_PARTNER_%' AND detail->>'contractId' IN (SELECT id::text FROM bzx_partner_contracts WHERE title LIKE '시험1609-%' OR prev_id IN (SELECT id FROM bzx_partner_contracts WHERE title LIKE '시험1609-%')); "
         "DELETE FROM notifications WHERE event_code = 'BZX_PARTNER_CONTRACT' AND title LIKE '%시험1609-%'; "
         "DELETE FROM bzx_partner_contracts WHERE prev_id IN (SELECT id FROM bzx_partner_contracts WHERE title LIKE '시험1609-%'); "
         "DELETE FROM bzx_partner_contracts WHERE title LIKE '시험1609-%';")
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    P = psql("SELECT p.id || '|' || a.email || '|' || coalesce(nullif(b.ceo_name, ''), b.company_name) FROM partners p JOIN businesses b ON b.id = p.business_id "
             "JOIN accounts a ON a.id = b.account_id WHERE p.status = 'ACTIVE' ORDER BY p.approved_at NULLS LAST LIMIT 1")
    old = {k: getset(k) for k in ('bzx.partner_esign', 'bzx.partner_notice')}
    if '|' not in P or '!' in P:
        print('  (ACTIVE 파트너 없음 — ② 건너뜀)', P[:80])
    else:
        pid, pmail, pname = P.split('|', 2)
        psql(CLEAN)
        try:
            setting('bzx.partner_esign', 'off', '1609'); setting('bzx.partner_notice', 'off', '1609')
            c1 = call('POST', '/admin/bzx/partner-contracts', {'partnerId': pid, 'title': f'시험1609-종이-{STAMP}', 'startOn': day(-355), 'endOn': day(10), 'noticeDays': 30, 'paper': True}, TS)
            r1 = job('bzx_daily', TS)
            al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'BZX_PARTNER_RENEW' AND detail->>'contractId' = '{c1.get('id')}' AND resolved_at IS NULL")
            lst = call('GET', '/admin/bzx/partner-contracts?due=1', None, TS)
            row = next((x for x in lst.get('items') or [] if x.get('id') == c1.get('id')), {})
            ok('② 종이 계약 적기 → SIGNED · PAPER · 정기 작업 bzx_daily 가 만기 알림 BZX_PARTNER_RENEW 한 줄 · 「갱신할 때」 목록 · 남은 날 10',
               c1.get('state') == 'SIGNED' and c1.get('signMode') == 'PAPER' and al == '1' and row.get('due') is True and row.get('daysLeft') == 10 and lst.get('signMode') == 'ASSUME',
               f"{c1} {r1.get('detail') or r1} {al} {row}")
            r2 = job('bzx_daily', TS)
            al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'BZX_PARTNER_RENEW' AND detail->>'contractId' = '{c1.get('id')}'")
            rn = call('POST', '/admin/bzx/partner-contracts', {'prevId': c1.get('id'), 'endOn': day(375)}, TS)
            dup = call('POST', '/admin/bzx/partner-contracts', {'prevId': c1.get('id'), 'endOn': day(380)}, TS)
            ppr = call('POST', '/admin/bzx/partner-contracts', {'prevId': c1.get('id'), 'endOn': day(380), 'paper': True}, TS)
            one = call('GET', f"/admin/bzx/partner-contracts/{rn.get('id')}", None, TS)
            ok('② 두 번 돌려도 알림 한 줄 · 갱신 보내기 → SENT · 간주(ASSUME) · 본문에 표준계약서 · 지문 64자 · 같은 갱신 두 번 409 · 갱신을 종이로 422',
               al2 == '1' and rn.get('state') == 'SENT' and rn.get('signMode') == 'ASSUME' and '파트너 표준계약서' in (one.get('body') or '') and len(one.get('docHash') or '') == 64
               and dup.get('_err') == 409 and dup.get('code') == 'BZX_PC_RENEWING' and ppr.get('_err') == 422,
               f"{al2} {rn} {dup.get('_err')} {dup.get('code')} {ppr.get('_err')} {ppr.get('code')}")
            g = psql(f"UPDATE bzx_partner_contracts SET body = body || 'x' WHERE id = {rn.get('id')}")
            ok('② DB 가 본문 고치기를 막음(BZX_PC)', 'BZX_PC' in g, g[-80:])
            consent_ok.agree(pmail, PW)
            TP = login(pmail)
            if not TP:
                print('  (파트너 대표 로그인 못 함 — 서명 단계 건너뜀)', pmail)
            else:
                mine = call('GET', '/partner/bzx/contracts', None, TP)
                it = next((x for x in mine.get('items') or [] if x.get('id') == rn.get('id')), {})
                bad = call('POST', f"/partner/bzx/contracts/{rn.get('id')}/sign", {'signerName': '다른사람1609', 'agree': True, 'docHash': it.get('docHash')}, TP)
                noag = call('POST', f"/partner/bzx/contracts/{rn.get('id')}/sign", {'signerName': pname, 'agree': False}, TP)
                sg = call('POST', f"/partner/bzx/contracts/{rn.get('id')}/sign", {'signerName': pname, 'agree': True, 'docHash': it.get('docHash')}, TP)
                again = call('POST', f"/partner/bzx/contracts/{rn.get('id')}/sign", {'signerName': pname, 'agree': True}, TP)
                res = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'BZX_PARTNER_RENEW' AND detail->>'contractId' = '{c1.get('id')}' AND resolved_at IS NOT NULL")
                nopt = call('GET', '/partner/bzx/contracts', None, TS)
                ok('② 파트너센터 — 내 계약에 본문 · 지문 · 다른 이름 422 · 동의 없음 422 · 대표자 이름으로 서명 → SIGNED(간주 · 법적 전자서명 아님) · 다시 서명 409 · 옛 계약 만기 알림 풀림 · 파트너 아닌 계정 404',
                   bool(it.get('body')) and bad.get('_err') == 422 and bad.get('code') == 'BZX_PC_SIGNER' and noag.get('_err') == 422 and sg.get('state') == 'SIGNED' and sg.get('stub') is True
                   and again.get('_err') == 409 and res == '1' and nopt.get('_err') == 404,
                   f"{bool(it.get('body'))} {bad.get('code')} {noag.get('code')} {sg} {again.get('code')} {res} {nopt.get('_err')}")
            ex = call('POST', '/admin/bzx/partner-contracts', {'partnerId': pid, 'title': f'시험1609-지남-{STAMP}', 'startOn': day(-40), 'endOn': day(-1), 'paper': True}, TS)
            job('bzx_daily', TS)
            st = psql(f"SELECT state FROM bzx_partner_contracts WHERE id = {ex.get('id') or 0}")
            ea = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'BZX_PARTNER_EXPIRED' AND detail->>'contractId' = '{ex.get('id')}'")
            cn = call('POST', f"/admin/bzx/partner-contracts/{ex.get('id')}/cancel", {'reason': '시험 1609'}, TS)
            ok('② 만기 지난 계약 → EXPIRED · 운영 알림 BZX_PARTNER_EXPIRED · 서명 끝난 계약 취소 409',
               st == 'EXPIRED' and ea == '1' and cn.get('_err') == 409, f"{ex} {st} {ea} {cn.get('_err')}")
            if ADMIN_WEB:
                def chk(pg, seen):
                    pg.wait_for_selector('[data-bzx-pc]', timeout=30000); pg.wait_for_timeout(800)
                    seen['row'] = pg.locator(f'[data-bzx-pc-row="{c1.get("id")}"]').count()
                    seen['form'] = pg.locator('[data-bzx-pc-form]').count()
                res3 = admin_page('/#/bzx-ptn-contract', chk)
                if res3 is None:
                    print('  (playwright 없음 — ③ 건너뜀)')
                else:
                    seen, perr = res3
                    ok('③ 화면 — 파트너사 › 파트너 계약 갱신 · 계약 줄 · 보내기 상자 · 화면 오류 없음', seen.get('row') == 1 and seen.get('form') == 1 and not perr, f"{seen} {perr[:2]}")
        finally:
            psql(CLEAN)
            for k, v in old.items():
                setting(k, v or 'off', '1609 되돌림')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
