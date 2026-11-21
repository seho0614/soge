"""v10.523 (D278 · docs/661) 일본어 · 중국어(간체) — 사용자 웹 · 서버 문장 사전 틀(기계 번역 초안 표시) · 빠진 문장은 영어 · 검수 기록 · 검수 전 켜기 막음 · 언어 단추는 켜진 언어만
  ① (코드) ja.json · zh.json(글자만 · 키 · 자리표시 · 한글 없음 · 복수형 other) · 초안 표 수 · 사전 묶기 · 서버 사전 · 영어로 · zh 지시문 · D278 · 메뉴(옛 시험 글자 그대로) · 문서 661
  ② (API · DB) 회원 403 · 현황 · 검수 없이 켜기 막힘 · 반려 메모 422 · 404 · 사이트만 승인 422 · 둘 다 승인 켜기 · 끄기 · 기록 고치기 · 지우기 막음 · 권한 주소
  ③ (화면) 관 관리 › 일본어 · 중국어 검수
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


# ① 코드
M = 'site/src/i18n/messages/'


def flat(d, p=''):
    out = {}
    for k, v in d.items():
        out.update(flat(v, p + k + '.') if isinstance(v, dict) else {p + k: v})
    return out


KO = flat(json.loads(rd(M + 'ko.json') or '{}'))
PH = lambda s: set(re.findall(r'\{(\w+)[},]', s))
KANA = re.compile('[぀-ヿ]')
for lg in ('ja', 'zh'):
    raw = json.loads(rd(M + lg + '.json') or '{}')
    d = {k: v for k, v in flat(raw).items() if k != '_draft'}
    bad_t = [k for k, v in flat(raw).items() if not isinstance(v, str)]
    ok(f'① 사용자 웹 {lg}.json — 초안 표시 · 값은 글자만 · 키는 한국어 사전 안 · 자리표시 · <b> 짝 같음 · 한글 없음 · 복수형은 other 만',
       str(raw.get('_draft', '')).startswith('MACHINE_DRAFT') and not bad_t and len(d) >= 50 and all(k in KO for k in d)
       and all(PH(KO[k]) == PH(v) for k, v in d.items()) and all(KO[k].count('<b>') == v.count('<b>') for k, v in d.items())
       and not any(re.search('[가-힣]', v) for v in d.values()) and not any(' one {' in v for v in d.values())
       and (any(KANA.search(v) for v in d.values()) if lg == 'ja' else not any(KANA.search(v) for v in d.values())),
       f"{len(d)} {bad_t[:3]} {[k for k in d if k not in KO][:3]}")
DR = rd('site/src/i18n/drafts.ts'); LD = rd('src/modules/i18n/lang-drafts.ts')
nj = len([k for k in flat(json.loads(rd(M + 'ja.json') or '{}')) if k != '_draft']); nz = len([k for k in flat(json.loads(rd(M + 'zh.json') or '{}')) if k != '_draft'])
ok('① 초안 표(사용자 웹 drafts.ts · 서버 lang-drafts.ts) 문장 수 = 실제 사전 · 한국어 바탕 수 = ko.json',
   f"ja: {{ state: 'MACHINE_DRAFT', keys: {nj}," in DR and f"zh: {{ state: 'MACHINE_DRAFT', keys: {nz}," in DR
   and f"ja: {{ state: 'MACHINE_DRAFT', keys: {nj}, koBase: {len(KO)}," in LD and f"zh: {{ state: 'MACHINE_DRAFT', keys: {nz}, koBase: {len(KO)}," in LD
   and "LANG_FALLBACK: Record<string, string> = { ja: 'en', zh: 'en' }" in DR, f"{nj} {nz} {len(KO)}")
IX = rd(M + 'index.ts')
ok('① 사전 묶기 — 초안 언어는 영어를 바탕으로 덮음 · _draft 는 내려보내지 않음 · 옛 시험이 보는 줄 그대로',
   'if (fb) return merge(await messagesFor(fb), await draftOver(locale));' in IX and 'delete over._draft;' in IX and 'return merge(KO as unknown as Dict, over);' in IX
   and re.search(r'const SHARED = \{ gwan, money, shop, listing, searchPop[ ,}]', IX), '')
EN = {}
for m in re.finditer(r'^  ("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$', rd('src/common/i18n/server-text.en.ts'), re.M):
    EN[json.loads(m.group(1))] = json.loads(m.group(2))
for lg in ('ja', 'zh'):
    src = rd(f'src/common/i18n/server-text.{lg}.ts')
    dd = {json.loads(a): json.loads(b) for a, b in re.findall(r'^  ("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),$', src, re.M)}
    ok(f'① 서버 문장 {lg} — 초안 표시 · 키는 영어 사전에도 있음 · 자리 수 같음 · 한글 없음',
       "state: 'MACHINE_DRAFT'" in src and len(dd) >= 20 and all(k in EN for k in dd)
       and all(sorted(re.findall(r'\{\d+\}', k)) == sorted(re.findall(r'\{\d+\}', v)) for k, v in dd.items()) and not any(re.search('[가-힣]', v) for v in dd.values()),
       f"{len(dd)} 영어에 없음 {[k for k in dd if k not in EN][:2]}")
ST = rd('src/common/i18n/server-text.ts')
ok('① 서버 옮기기 — ja · zh 사전 · 없으면 영어 · 옛 시험(1125)이 보는 글자 그대로 · 기계 번역 지시문에 zh',
   'ja: SERVER_TEXT_JA, zh: SERVER_TEXT_ZH' in ST and "const FALLBACK: Record<string, string> = { ja: 'en', zh: 'en' };" in ST and 'function serverTextOne(' in ST
   and "if (hit != null) return text === t ? hit : text.replace(t, hit);" in ST and "serverText((m[Number(i) + 1] ?? '').trim(), lang, depth + 1)" in ST
   and "zh: 'Simplified Chinese'" in rd('src/modules/i18n/translate.service.ts'), '')
SQL = rd('prisma/migrations/D278_partner_api_bulk_invite_ja_zh/migration.sql')
ok('① D278 — zh(간체) 꺼진 채 · 검수 기록(쌓기만) · ja · zh 켜기는 SITE · SERVER 승인 뒤(DB 트리거)',
   "('zh', '중국어(간체)', '简体中文', false, false, 8)" in SQL and 'trg_i18n_review_block' in SQL and 'trg_i18n_draft_lang_guard' in SQL and "scope IN ('SITE', 'SERVER')" in SQL, '')
MN = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx')
ok('① 메뉴 — 관 관리 › 일본어 · 중국어 검수 · 옛 시험(1093 · 1339 · 1347)이 보는 목록 글자 그대로 · 검수 컨트롤러는 i18n.controller 밖',
   "'gwan-ux', 'hub', 'i18n-review'" in MN and "'checklist', 'guide-flows', 'faq', 'ops-guide', 'siteinfo', 'terms', 'manual', 'i18n'] }" in MN
   and "{tab === 'i18n-review' && <I18nReview />}" in APP and 'i18n-review' not in rd('src/modules/i18n/i18n.controller.ts'), '')
D661 = doc('661_')
ok('① 문서 661 — 기계 번역 초안 · 검수 · 법무 확인 · 옛 시험 1093(언어 8 → 9)', all(x in D661 for x in ('기계 번역 초안', '검수', '법무 확인', 'test_v1093')), '')
ok('① 판 v10.523 이상', VT >= (10, 523), VER)

if API and DB:
    TAG = 'v1523-' + str(int(time.time()))
    rids = []
    start = psql("SELECT coalesce(max(id), 0) FROM i18n_lang_reviews")
    zh0 = psql("SELECT is_active::text FROM i18n_langs WHERE code = 'zh'")
    try:
        TS, TB = login('admin@x.com'), login('buyer@x.com')
        psql("SET session_replication_role = replica; UPDATE i18n_langs SET is_active = false WHERE code = 'zh';")
        mb = call('GET', '/admin/i18n-review', t=TB)
        ov = call('GET', '/admin/i18n-review', t=TS)
        zi = next((x for x in ov.get('items') or [] if x.get('code') == 'zh'), {})
        db_on = psql("UPDATE i18n_langs SET is_active = true WHERE code = 'zh'") if not psql("SELECT count(*) FROM i18n_lang_reviews WHERE lang = 'zh'") != '0' else '!I18N_REVIEW(기록 있음 · 건너뜀)'
        ok('② 회원 403 · 현황 ja · zh(zh 꺼짐 · 사전 수) · 검수 없이 DB 로 켜기 막힘(I18N_REVIEW)',
           mb.get('_err') == 403 and {x.get('code') for x in ov.get('items') or []} == {'ja', 'zh'} and zi.get('exists') is True and zi.get('isActive') is False
           and int((zi.get('site') or {}).get('keys') or 0) >= 50 and int((zi.get('server') or {}).get('keys') or 0) >= 20 and 'I18N_REVIEW' in db_on,
           f"{mb.get('_err')} {zi.get('isActive')} {zi.get('site')} {db_on[-50:]}")
        rj = call('POST', '/admin/i18n-review/zh', {'scope': 'SITE', 'verdict': 'REJECTED', 'reviewer': '시험 검수자'}, TS)
        badl = call('POST', '/admin/i18n-review/fr', {'scope': 'SITE', 'verdict': 'APPROVED', 'reviewer': '시험 검수자'}, TS)
        a1 = call('POST', '/admin/i18n-review/zh', {'scope': 'SITE', 'verdict': 'APPROVED', 'reviewer': '시험 검수자', 'note': TAG}, TS)
        mid = call('GET', '/admin/i18n-review', t=TS)
        can_mid = next((x for x in mid.get('items') or [] if x.get('code') == 'zh'), {}).get('canActivate')
        on_mid = call('POST', '/admin/i18n/langs/zh', {'isActive': True}, TS)
        a2 = call('POST', '/admin/i18n-review/zh', {'scope': 'SERVER', 'verdict': 'APPROVED', 'reviewer': '시험 검수자', 'note': TAG}, TS)
        for x in (a1, a2):
            if x.get('id'):
                rids.append(x['id'])
        aft = call('GET', '/admin/i18n-review', t=TS)
        can_aft = next((x for x in aft.get('items') or [] if x.get('code') == 'zh'), {}).get('canActivate')
        on_ok = call('POST', '/admin/i18n/langs/zh', {'isActive': True}, TS)
        off_ok = call('POST', '/admin/i18n/langs/zh', {'isActive': False}, TS)
        ok('② 반려에 메모 없음 422 · 대상 아닌 언어 404 · 사이트만 승인 → 못 켬(422 I18N_REVIEW) · 서버 문장도 승인 → 켜기 · 끄기 200',
           rj.get('code') == 'I18N_REVIEW_NOTE' and badl.get('_err') == 404 and can_mid is False and on_mid.get('_err') == 422 and on_mid.get('code') == 'I18N_REVIEW'
           and can_aft is True and on_ok.get('isActive') is True and off_ok.get('isActive') is False,
           f"{rj.get('code')} {badl.get('_err')} {can_mid} {on_mid.get('code')} {can_aft} {on_ok} {off_ok}")
        rid = int(rids[0]) if rids else 0
        dbu = psql(f"UPDATE i18n_lang_reviews SET verdict = 'REJECTED' WHERE id = {rid}")
        dbd = psql(f"DELETE FROM i18n_lang_reviews WHERE id = {rid}")
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'i18n-review'")
        ok('② 검수 기록은 DB 가 고치기 · 지우기 막음 · 권한 주소 2', 'I18N_REVIEW' in dbu and 'I18N_REVIEW' in dbd and rmap == '2', f"{dbu[-30:]} {dbd[-30:]} {rmap}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM i18n_lang_reviews WHERE id > {int(start or 0)} AND lang = 'zh' AND reviewer = '시험 검수자';")
        psql(f"SET session_replication_role = replica; UPDATE i18n_langs SET is_active = {'true' if zh0 == 'true' else 'false'} WHERE code = 'zh';")
    if ADMIN_WEB:
        r = admin_page('/#/i18n-review', lambda pg, seen: seen.update(n=pg.locator('[data-i18nr]').count(), langs=pg.locator('[data-i18nr-lang]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 관 관리 › 일본어 · 중국어 검수(언어 2 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('langs') == 2 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        print('  (사용자 웹 — 다국어 전체 스위치를 건드리지 않으려고 화면 단계는 두지 않음 · 사전 모양은 ① 에서 봄)')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
