"""v10.556 (docs/694) 월간 뉴스레터 — 대표 11/21 「(58) ① 뉴스레터」
  ① (코드) 운영 API OpzNewsletterController(보내기 SUPER) · 보내는 길은 ㊳ 캠페인(EMAIL · 대상 ALL · 마케팅 동의 · (광고) · 수신 거부 그대로) · ㊿ renderMailTemplate 재사용 · 본문 2,000자 · 표 opz_nl_issues · opz.nl_enabled off · 권한 · 메뉴 · 화면 OPZ-010 · 문서 694
  ② (API · DB) 초안 · 같은 달 409 · 틀린 달 400 · 틀 검사 422 · 고를 수 없는 항목 422 · 미리보기(광고 · 보낸 곳 · 수신 거부) · 꺼짐 OPZ_NL_OFF · 나에게 시험 → 캠페인 초안(EMAIL · ALL) · 켜도 캠페인 꺼짐이면 MKT_OFF · 취소(캠페인도) · DB 가 고치기 · 지우기 막음 · 설정 검사
  ③ (화면) 회원 › 월간 뉴스레터
  (두 번 돌아도 통과 — 2098년 시험 호 · 그 캠페인은 시작 · 끝에 replica 로 지움 · 설정은 처음 값으로)
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


M88 = migr('D288_')
CT, NL, ST = rd('src/modules/opz/opz.controller.ts'), rd('src/modules/opz/newsletter.ts'), rd('src/modules/opz/opz-settings.ts')
UI, MN, AP = rd('web/src/app/admin/Opz.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')

ok('① 코드 — 뉴스레터 운영 API(OpzNewsletterController · 보내기 SUPER) · ㊳ 캠페인으로 보냄(createCampaign · testCampaign · sendCampaign · 대상 ALL) · ㊿ renderMailTemplate 재사용 · 본문 2,000자 · 틀 주소 금지 · 표 opz_nl_issues(달마다 한 호 · 보낸 뒤 못 고침) · opz.nl_enabled off · 권한 시드 · 메뉴 opz-newsletter(캠페인 뒤) · 화면 OPZ-010 · 문서 694 · 판 v10.556',
   'export class OpzNewsletterController' in CT and "@Controller('api/v1/admin/opz')" in CT and "@Post('newsletters/:id/send')" in CT and "@Roles('SUPER')" in CT
   and "from '../marketing/campaign'" in NL and 'sendCampaign(db, mail, campaignId' in NL and 'testCampaign(db, mail, campaignId' in NL and "audience: 'ALL'" in NL
   and "from '../csx/mail-render'" in NL and 'renderMailTemplate(' in NL and 'NL_BODY_MAX = 2000' in NL and 'NL_URL_RE = /https?:\\/\\//i' in NL
   and 'CREATE TABLE IF NOT EXISTS public.opz_nl_issues' in M88 and "frame !~* 'https?://'" in M88 and 'ux_opz_nl_issues_ym' in M88 and 'trg_opz_nl_guard' in M88
   and "('opz.nl_enabled', 'off'" in M88 and "('opz-newsletter', '월간 뉴스레터', 'admusr'" in M88 and "('POST', '/admin/opz/newsletters/{id}/send', 'opz-newsletter', 'APPROVE')" in M88
   and "['opz-newsletter', '월간 뉴스레터']" in MN and "'mkt-campaign', ['opz-newsletter']" in MN and "{tab === 'opz-newsletter' && <OpzNewsletter />}" in AP
   and 'export function OpzNewsletter' in UI and '"SB-ADM-OPZ-010"' in SJ and '"POST /admin/opz/newsletters/{id}/send"' in SJ
   and '(광고)' in doc('694_') and VT >= (10, 556), VER)

YM = f"2098-{(int(time.time()) % 12) + 1:02d}"
CLEAN = ("BEGIN; SET LOCAL session_replication_role = replica; "
         "CREATE TEMP TABLE t1556 AS SELECT campaign_id FROM opz_nl_issues WHERE ym LIKE '2098-%' AND campaign_id IS NOT NULL "
         "UNION SELECT id FROM mkt_campaigns WHERE title LIKE '뉴스레터 2098-%'; "
         "DELETE FROM opz_nl_issues WHERE ym LIKE '2098-%'; "
         "DELETE FROM mkt_unsubscribes WHERE campaign_id IN (SELECT campaign_id FROM t1556); "
         "DELETE FROM mkt_campaign_sends WHERE campaign_id IN (SELECT campaign_id FROM t1556); "
         "DELETE FROM mkt_campaigns WHERE id IN (SELECT campaign_id FROM t1556); COMMIT;")

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    old_on, old_items = getset('opz.nl_enabled'), getset('opz.nl_items')
    psql(CLEAN)
    try:
        setting('opz.nl_enabled', 'off', '1556')
        mk = call('POST', '/admin/opz/newsletters', {'ym': YM}, TS)
        nid = str(mk.get('id') or '')
        dup = call('POST', '/admin/opz/newsletters', {'ym': YM}, TS)
        bym = call('POST', '/admin/opz/newsletters', {'ym': '2098-13'}, TS)
        d0 = call('GET', f'/admin/opz/newsletters/{nid}', None, TS)
        cand = d0.get('candidates') or {}
        pv = d0.get('preview') or {}
        ok('② 뉴스레터 만들기 — 초안 · 같은 달 409 OPZ_NL_EXISTS · 틀린 달 400 · 한 호(초안 · 후보 셋 · 본문 한도 2,000 · 미리보기 제목 (광고) 앞머리 · 틀 문제 없음)',
           mk.get('ok') is True and nid.isdigit() and dup.get('_err') == 409 and dup.get('code') == 'OPZ_NL_EXISTS' and bym.get('_err') == 400
           and (d0.get('issue') or {}).get('state') == 'DRAFT' and set(cand.keys()) == {'notices', 'listings', 'events'}
           and (d0.get('rendered') or {}).get('max') == 2000 and (not pv or str(pv.get('subject') or '').startswith('(광고)')) and d0.get('problems') == [],
           f"{mk.get('note')} · {dup.get('code')} · {bym.get('_err')} · {(d0.get('issue') or {}).get('state')} · {sorted(cand.keys())} · {pv.get('subject')}")

        u1 = call('PUT', f'/admin/opz/newsletters/{nid}', {'frame': '{intro}\nhttps://x.example {base}'}, TS)
        u2 = call('PUT', f'/admin/opz/newsletters/{nid}', {'frame': '{intro}\n{foo} {base}'}, TS)
        u3 = call('PUT', f'/admin/opz/newsletters/{nid}', {'intro': '수신 거부는 아래에서'}, TS)
        u4 = call('PUT', f'/admin/opz/newsletters/{nid}', {'noticeIds': ['00000000-0000-4000-8000-000000000000']}, TS)
        u5 = call('PUT', f'/admin/opz/newsletters/{nid}', {'intro': '시험 1556 소식입니다.', 'frame': '{intro}\n\n{listings}\n\n{base}', 'noticeIds': [], 'eventIds': [], 'listingIds': []}, TS)
        d1 = call('GET', f'/admin/opz/newsletters/{nid}', None, TS)
        txt = str((d1.get('preview') or {}).get('text') or '')
        ok('② 고치기 — 틀에 주소 · 없는 자리값 · 수신 거부 글 422 OPZ_NL_FRAME · 고를 수 없는 공지 422 OPZ_NL_PICK · 맞는 틀 저장 · 미리보기에 첫 인사 · 보낸 곳 · 수신 거부 자리(서버가 붙임)',
           u1.get('code') == 'OPZ_NL_FRAME' and u2.get('code') == 'OPZ_NL_FRAME' and u3.get('code') == 'OPZ_NL_FRAME' and u4.get('code') == 'OPZ_NL_PICK'
           and u5.get('ok') is True and '시험 1556 소식입니다.' in txt and '보낸 곳:' in txt and '수신 거부(무료):' in txt and '(이번 달은 없습니다)' in txt,
           f"{u1.get('code')} {u2.get('code')} {u3.get('code')} {u4.get('code')} · {u5.get('note')} · {txt[:80]!r}")

        s_off = call('POST', f'/admin/opz/newsletters/{nid}/send', {'confirm': '보내기'}, TS)
        tst = call('POST', f'/admin/opz/newsletters/{nid}/test', {}, TS)
        d2 = call('GET', f'/admin/opz/newsletters/{nid}', None, TS)
        cid = str((d2.get('issue') or {}).get('campaignId') or '')
        crow = psql(f"SELECT channel || '|' || audience || '|' || state || '|' || (title LIKE '뉴스레터 {YM}%')::text FROM mkt_campaigns WHERE id = {cid or 0}")
        camp_off = getset('campaign.enabled')
        s_mkt = None
        if camp_off == 'off':
            setting('opz.nl_enabled', 'on', '1556')
            s_mkt = call('POST', f'/admin/opz/newsletters/{nid}/send', {'confirm': '보내기'}, TS)
            setting('opz.nl_enabled', 'off', '1556')
        ok('② 시험 · 보내기 — 꺼짐 422 OPZ_NL_OFF · 나에게 시험(캠페인 시험 · 간주면 기록만 · 또는 MKT_ 까닭) · 캠페인 초안 한 줄(EMAIL · ALL · 초안 · 이름 뉴스레터 달) · 켜도 캠페인 꺼짐이면 MKT_OFF(캠페인 서버가 막음)',
           s_off.get('_err') == 422 and s_off.get('code') == 'OPZ_NL_OFF'
           and (tst.get('ok') is True or str(tst.get('code') or '').startswith('MKT_')) and cid.isdigit() and crow == 'EMAIL|ALL|DRAFT|true'
           and (s_mkt is None or s_mkt.get('code') == 'MKT_OFF'),
           f"{s_off.get('code')} · {tst.get('ok')} {tst.get('mode')} {tst.get('code')} · {cid} {crow} · {camp_off} {None if s_mkt is None else s_mkt.get('code')}")

        cn = call('POST', f'/admin/opz/newsletters/{nid}/cancel', {'reason': '시험 1556 끝'}, TS)
        cn2 = call('POST', f'/admin/opz/newsletters/{nid}/cancel', {'reason': '시험 1556 끝'}, TS)
        u6 = call('PUT', f'/admin/opz/newsletters/{nid}', {'title': '시험 1556 다시'}, TS)
        cst = psql(f"SELECT state FROM mkt_campaigns WHERE id = {cid or 0}")
        g1 = psql(f"UPDATE opz_nl_issues SET title = '시험 1556 바꿈' WHERE id = {nid or 0}")
        g2 = psql(f"DELETE FROM opz_nl_issues WHERE id = {nid or 0}")
        g3 = psql(f"UPDATE opz_nl_issues SET state = 'DRAFT' WHERE id = {nid or 0}")
        st0 = call('PUT', '/admin/opz/newsletter-settings', {'nlItems': 11, 'reason': '시험 1556'}, TS)
        st1 = call('PUT', '/admin/opz/newsletter-settings', {'reason': '시험 1556'}, TS)
        ok('② 취소 — 초안 취소 · 캠페인도 취소 · 두 번 409 · 취소한 호 고치기 409 OPZ_NL_STATE · DB 가 글 고치기 · 지우기 · 되돌리기 막음(OPZ_NL) · 설정 범위 400 · 바꿀 것 없음 422 OPZ_NOTHING',
           cn.get('ok') is True and cst == 'CANCELED' and cn2.get('_err') == 409 and u6.get('_err') == 409 and u6.get('code') == 'OPZ_NL_STATE'
           and '!' in g1 and 'OPZ_NL' in g1 and '!' in g2 and 'OPZ_NL' in g2 and '!' in g3 and 'OPZ_NL' in g3
           and st0.get('_err') == 400 and st1.get('_err') == 422 and st1.get('code') == 'OPZ_NOTHING',
           f"{cn.get('note')} · {cst} · {cn2.get('code')} · {u6.get('code')} · {g1[-60:]!r} · {st0.get('_err')} {st1.get('code')}")
        if ADMIN_WEB:
            r = admin_page('/#/opz-newsletter', lambda pg, seen: seen.update(n=pg.locator('[data-opz-nl]').count(), s=pg.locator('[data-opz-settings=nl]').count()))
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 회원 › 월간 뉴스레터(설정 · 목록 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
    finally:
        setting('opz.nl_enabled', old_on or 'off', '1556 되돌림')
        if old_items:
            setting('opz.nl_items', old_items, '1556 되돌림')
        psql(CLEAN)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
