"""v10.483 (D268 · docs/621) 문자 · 메일 캠페인 — 마케팅 수신 동의자만 · 야간 동의 · (광고) · 수신 거부 · 발송 기록 · 처음 꺼짐 · 간주
  ① (코드) D268 캠페인 · 받는 사람 · 수신 거부 표 · DB 트리거(동의 · 야간 · 상태) · 감시 보기 · 설정 campaign.* · 정기 작업 mkt_campaign_send · 서비스 · 컨트롤러 · 메뉴 · 화면 SCU-010 · 문서 621
  ② (API · DB) 회원 403 · 초안 · 글에 수신 거부 422 · 받을 사람 · 시험 보내기((광고) · 수신 거부 링크) · 꺼짐 422 · ADMIN 설정 403 · 확인 글자 422 · 보내기(동의자만) · 고치기 409 · DB 막음 · 지금 보내기(간주 · 야간) · 감시 0 · 수신 거부(화면 · 철회 · 두 번) · LIVE 준비 안 됨 422 · 취소 · 권한 주소 10
  ③ (화면) 회원 › 문자 · 메일 캠페인
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


def raw_get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, method='GET'), timeout=60)
        return r.status, r.headers.get('content-type', ''), r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('content-type', ''), ''


def raw_form(url, data):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), headers={'content-type': 'application/x-www-form-urlencoded'}, method='POST'), timeout=60)
        return r.status, r.headers.get('content-type', ''), r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('content-type', ''), ''


M68 = migr('D268_')
kst_h = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).hour
NIGHT = kst_h >= 21 or kst_h < 8

CP, CC, SCH, WK, MN, AP, UI = (rd('src/modules/marketing/campaign.ts'), rd('src/modules/marketing/campaign.controller.ts'), rd('src/worker/scheduler.service.ts'),
                               rd('src/worker/worker.controller.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/MktCampaigns.tsx'))
ok('① 코드 — D268 캠페인 · 받는 사람(동의 · 야간 DB 트리거) · 수신 거부(쌓기만) · 감시 보기 · 설정 campaign.enabled off · ASSUME · 정기 작업 5분 · (광고) · 수신 거부 링크(HMAC · 지문) · 야간 판정 · 컨트롤러(공개 /site/unsubscribe) · 메뉴 mkt-campaign · 화면 SCU-010 · 문서 621 · 판 v10.483',
   'CREATE TABLE IF NOT EXISTS public.mkt_campaigns' in M68 and 'CREATE TABLE IF NOT EXISTS public.mkt_campaign_sends' in M68 and 'trg_mkt_send_guard' in M68
   and "'MKT_NIGHT: " in M68 and "'MKT_NO_CONSENT: " in M68 and 'v_mkt_consent_violation' in M68 and "('campaign.enabled', 'off'" in M68 and "('campaign.send_mode', 'ASSUME'" in M68
   and "('mkt_campaign_send', 5, NULL" in M68 and "('mkt-campaign', '문자 · 메일 캠페인', 'admusr'" in M68
   and '(광고)' in CP and 'export function isNightKst' in CP and "createHmac('sha256', unsubKey())" in CP and 'MARKETING_NIGHT' in CP and 'mail_suppressions' in CP
   and "@Get('site/unsubscribe')" in CC and "@Post('marketing/campaigns/:id/send')" in CC and "case 'mkt_campaign_send':" in SCH and "'mkt_campaign_send'," in WK
   and "['mkt-campaign', '문자 · 메일 캠페인']" in MN and "{tab === 'mkt-campaign' && <MktCampaigns />}" in AP and 'export function MktCampaigns' in UI
   and '"SB-ADM-SCU-010"' in SJ and '정보통신망법' in doc('621_') and VT >= (10, 483), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    KEYS = ('campaign.enabled', 'campaign.send_mode', 'campaign.contact', 'campaign.batch')
    s0 = {k: getset(k) for k in KEYS}
    ea, aa = mk_staff('1483a', None); eb, ab = mk_staff('1483b', None); ec, ac = mk_staff('1483c', None); es, asf = mk_staff('1483s', 'ADMIN')
    mine = [aa, ab, ac, asf]
    cids = []
    mk_ok = psql("SELECT count(*) FROM v_terms_current WHERE code IN ('MARKETING', 'MARKETING_NIGHT')")
    if mk_ok != '2':
        print(f'  (마케팅 · 야간 약관이 지금 판이 아님({mk_ok}) — ② 건너뜀)')
    else:
        try:
            for a_, codes in ((aa, "'MARKETING', 'MARKETING_NIGHT'"), (ab, "'MARKETING'"), (asf, "'MARKETING'")):
                psql(f"INSERT INTO term_agreements (account_id, term_code, term_version, agreed) SELECT '{a_}', code, version, true FROM v_terms_current WHERE code IN ({codes})")
            TSF = login(es)
            setting('campaign.enabled', 'off', '1483'); setting('campaign.send_mode', 'ASSUME', '1483'); setting('campaign.contact', None, '1483')
            mb = call('GET', '/admin/marketing/campaigns', None, TB)
            bad = call('POST', '/admin/marketing/campaigns', {'title': '시험 1483 거부 글', 'channel': 'EMAIL', 'subject': '시험', 'body': '할인 안내입니다. 수신 거부는 여기로 연락 주세요.'}, TSF)
            smsl = call('POST', '/admin/marketing/campaigns', {'title': '시험 1483 긴 문자', 'channel': 'SMS', 'body': '가' * 700}, TSF)
            c1 = call('POST', '/admin/marketing/campaigns', {'title': f'시험 1483 메일 {int(time.time())}', 'channel': 'EMAIL', 'subject': '11월 건강검진 할인', 'body': '이번 달 건강검진 패키지를 20% 할인해 드립니다. 자세한 내용은 소개몰에서 확인해 주십시오.'}, TSF)
            cid = str(c1.get('id') or ''); cids.append(cid)
            aud = call('GET', f'/admin/marketing/campaigns/{cid}/audience', None, TSF)
            tst = call('POST', f'/admin/marketing/campaigns/{cid}/test', None, TSF)
            pv = tst.get('preview') or {}
            tok = (re.search(r't=([A-Za-z0-9_-]{20,100})', pv.get('text') or '') or [None, ''])[1]
            off = call('POST', f'/admin/marketing/campaigns/{cid}/send', {'confirm': '보내기'}, TS)
            adm = call('PUT', '/admin/marketing/settings', {'enabled': True, 'reason': '시험 1483'}, TSF)
            legal = None
            on = call('PUT', '/admin/marketing/settings', {'enabled': True, 'mode': 'ASSUME', 'reason': '시험 1483 켬'}, TS)
            legal = call('POST', f'/admin/marketing/campaigns/{cid}/send', {'confirm': '보내기'}, TS)
            call('PUT', '/admin/marketing/settings', {'contact': '1588-0000 (시험)', 'batch': 1000, 'reason': '시험 1483 연락처'}, TS)
            noc = call('POST', f'/admin/marketing/campaigns/{cid}/send', {'confirm': '보냄'}, TS)
            sd = call('POST', f'/admin/marketing/campaigns/{cid}/send', {'confirm': '보내기'}, TS)
            rows = {x.split('|')[0]: x.split('|')[1] for x in psql(f"SELECT account_id || '|' || state FROM mkt_campaign_sends WHERE campaign_id = {int(cid or 0)} AND NOT test").splitlines() if '|' in x}
            ed = call('PUT', f'/admin/marketing/campaigns/{cid}', {'body': '고친 글입니다 — 보내기 뒤에는 못 고침'}, TSF)
            dbe = psql(f"UPDATE mkt_campaigns SET body = '디비로 고친 글입니다 열 자 넘게' WHERE id = {int(cid or 0)}")
            dbi = psql(f"INSERT INTO mkt_campaign_sends (campaign_id, account_id, unsub_hash) VALUES ({int(cid or 0)}, '{ac}', repeat('a', 64))")
            run = call('POST', '/admin/marketing/run', None, TS)
            st = {x.split('|')[0]: x.split('|')[1:] for x in psql(f"SELECT account_id || '|' || state || '|' || coalesce(night::text, '') FROM mkt_campaign_sends WHERE campaign_id = {int(cid or 0)} AND NOT test").splitlines() if '|' in x}
            viol = psql('SELECT count(*) FROM v_mkt_consent_violation')
            cst = psql(f"SELECT state FROM mkt_campaigns WHERE id = {int(cid or 0)}")
            base = API.rsplit('/api/v1', 1)[0]
            g = raw_get(base + '/api/v1/site/unsubscribe?t=' + tok) if tok else (0, '', '')
            gbad = raw_get(base + '/api/v1/site/unsubscribe?t=' + 'x' * 30)
            u1 = call('POST', '/site/unsubscribe/json', {'t': tok}) if tok else {}
            cons = psql(f"SELECT agreed::text FROM v_term_consent_current WHERE account_id = '{asf}' AND term_code = 'MARKETING'")
            u2 = call('POST', '/site/unsubscribe/json', {'t': tok}) if tok else {}
            fpost = raw_form(base + '/api/v1/site/unsubscribe', {'t': tok}) if tok else (0, '', '')
            u404 = call('POST', '/site/unsubscribe/json', {'t': 'y' * 30})
            note = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{asf}' AND event_code = 'CONSENT_OPTOUT'")
            lst = call('GET', '/admin/marketing/campaigns', None, TS)
            c2 = call('POST', '/admin/marketing/campaigns', {'title': f'시험 1483 둘째 {int(time.time())}', 'channel': 'EMAIL', 'subject': '둘째', 'body': '둘째 캠페인 글입니다 — LIVE 준비 확인용.'}, TSF)
            cid2 = str(c2.get('id') or ''); cids.append(cid2)
            setting('campaign.send_mode', 'LIVE', '1483')
            live = call('POST', f'/admin/marketing/campaigns/{cid2}/send', {'confirm': '보내기'}, TS)
            setting('campaign.send_mode', 'ASSUME', '1483')
            cn = call('POST', f'/admin/marketing/campaigns/{cid2}/cancel', {'reason': '시험 1483 취소'}, TSF)
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'mkt-campaign'")
            mail_ready = bool((lst.get('ready') or {}).get('mail'))
            ok('② 캠페인 — 회원 403 · 글에 수신 거부 422 · 긴 문자 422 · 초안 · 받을 사람 2 이상 · 시험 보내기(간주 · (광고) 제목 · 수신 거부 링크) · 꺼짐 422 · ADMIN 설정 403 · 연락처 없음 422 · 확인 글자 422 · 보내기(동의 A · B 만 · C 빠짐) · 고치기 409 · DB 가 글 고치기 · 동의 없는 줄 막음',
               mb.get('_err') == 403 and bad.get('code') == 'MKT_OPTOUT_TEXT' and smsl.get('code') == 'MKT_SMS_LEN' and c1.get('ok') is True and (aud.get('consented') or 0) >= 2
               and tst.get('ok') is True and tst.get('mode') == 'ASSUME' and str(pv.get('subject') or '').startswith('(광고)') and '/api/v1/site/unsubscribe?t=' in (pv.get('text') or '') and bool(tok)
               and off.get('code') == 'MKT_OFF' and adm.get('_err') == 403 and on.get('ok') is True and (legal or {}).get('code') == 'MKT_LEGAL' and noc.get('code') == 'MKT_CONFIRM'
               and sd.get('ok') is True and rows.get(aa) == 'QUEUED' and rows.get(ab) == 'QUEUED' and ac not in rows
               and ed.get('code') == 'MKT_STATE' and 'MKT_STATE' in dbe and 'MKT_NO_CONSENT' in dbi,
               f"{mb.get('_err')} {bad.get('code')} {smsl.get('code')} {c1.get('ok')} {aud.get('consented')} · {tst.get('ok')} {tst.get('mode')} {str(pv.get('subject'))[:12]} {bool(tok)} · {off.get('code')} {adm.get('_err')} {(legal or {}).get('code')} {noc.get('code')} · {sd.get('ok') or sd} {rows.get(aa)} {rows.get(ab)} {ac in rows} · {ed.get('code')} {dbe[-40:]} {dbi[-40:]}")
            exp_b = 'QUEUED' if NIGHT else 'ASSUMED'
            ok('② 보내기 · 수신 거부 — 지금 보내기(A 간주 · B 는 야간이면 대기) · 감시 0 · 캠페인 끝(야간이면 보내는 중) · 거부 화면(HTML 단추) · 틀린 열쇠 화면 · 철회(MARKETING) · 두 번째는 이미 · 폼 POST 화면 · 없는 열쇠 404 · 처리 결과 알림 · LIVE 메일 준비 안 됨 422 · 취소 · 권한 주소 10',
               run.get('on') is True and (st.get(aa) or [''])[0] == 'ASSUMED' and (st.get(ab) or [''])[0] == exp_b and viol == '0' and cst == ('SENDING' if NIGHT else 'DONE')
               and g[0] == 200 and 'text/html' in g[1] and 'method="post"' in g[2] and gbad[0] == 200 and '맞지 않습니다' in gbad[2]
               and u1.get('ok') is True and u1.get('withdrew') == ['MARKETING'] and cons == 'false' and u2.get('already') is True
               and fpost[0] == 200 and 'text/html' in fpost[1] and u404.get('_err') == 404 and note == '1'
               and (mail_ready or live.get('code') == 'MKT_NOT_READY') and cn.get('ok') is True and rmap == '10',
               f"{run.get('on')} {st.get(aa)} {st.get(ab)}(기대 {exp_b}) 감시 {viol} {cst} · {g[0]} {g[1][:20]} {gbad[0]} · {u1.get('withdrew')} {cons} {u2.get('already')} {fpost[0]} {u404.get('_err')} 알림 {note} · {live.get('code')} {cn.get('ok')} · {rmap}")
        finally:
            ids = ','.join(x for x in cids if x.isdigit()) or '0'
            acc = ','.join(f"'{x}'" for x in mine if x)
            psql(f"SET session_replication_role = replica; DELETE FROM mkt_unsubscribes WHERE campaign_id IN ({ids}); DELETE FROM mkt_campaign_sends WHERE campaign_id IN ({ids}); DELETE FROM mkt_campaigns WHERE id IN ({ids}); "
                 f"DELETE FROM term_agreements WHERE account_id IN ({acc}) AND term_code IN ('MARKETING', 'MARKETING_NIGHT'); DELETE FROM notifications WHERE account_id IN ({acc}) AND event_code = 'CONSENT_OPTOUT'; "
                 f"DELETE FROM ops_alerts WHERE alert_code = 'MKT_CAMPAIGN_STUCK' AND detail->>'campaign' IN (SELECT unnest(string_to_array('{ids}', ',')));")
            for k, x in s0.items():
                setting(k, x or None, '1483 되돌림')
            rm_role(asf, '1483')
    if ADMIN_WEB:
        r = admin_page('/#/mkt-campaign', lambda pg, seen: seen.update(n=pg.locator('[data-mkt-campaigns]').count(), on=pg.locator('[data-mkt-on]').get_attribute('data-mkt-on') if pg.locator('[data-mkt-on]').count() else None))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 문자 · 메일 캠페인(켜짐 표시 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('on') in ('on', 'off') and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
