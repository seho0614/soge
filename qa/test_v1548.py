"""v10.548 (docs/686) 번역 메모리 — 대표 11/20 「(55) ③ 번역 메모리」
  ① (코드) D285 sfx_tm(언어 · 원문 열쇠 고유 · 열쇠 = 공백 정리 md5) · 채우는 트리거(승인 · 자동 승인 · 사람 먼저 · 글 · 댓글 · MOCK · TM 빼고) · 채우기 함수 · 엔진 TM · 자동 번역 배치 앞에 끼움(FORCE 건너뜀) · sfx.tm off · 서버 · 메뉴 · 화면 · 문서 686
  ② (API · DB) 열쇠 공백 정리 · 꺼짐이면 안 채움 · 사람 번역 채움 · 엔진 번역이 사람 것을 못 덮음 · 자동 번역 배치가 메모리를 씀(TM_REUSED · 엔진 안 부름 · 쓰인 횟수) · 찾기 · 고치기(HUMAN) · 빈 칸 422 · 끄기 · 없는 줄 404 · 채우기 꺼짐 422 · 회원 403 · 권한 주소 · 되돌림
  ③ (화면) 관 관리 › 번역 메모리
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


def callh(m_, p, b=None, t=None, h=None):
    """call 과 같되 머리글(X-Device-Mark 등)을 더함"""
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    hd.update(h or {})
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


M85 = migr('D285_')
CT = rd('src/modules/sfx/sfx.controller.ts')
UI = rd('web/src/app/admin/Sfx.tsx')
MN = rd('web/src/lib/adminMenu.ts')
AP = rd('web/src/App.tsx')
SJ = rd('spec/screens.json')
T0 = psql("SELECT clock_timestamp()::text") if (API and DB) else ''

TM = rd('src/modules/sfx/tm.ts')
TR = rd('src/modules/i18n/translate.service.ts')
TW = rd('web/src/app/admin/Translations.tsx')

ok('① 코드 — D285 번역 메모리 표(언어 · 원문 열쇠 고유 · 열쇠 CHECK) · 열쇠 함수(공백 정리 md5) · 채우는 트리거(승인 · 자동 승인 · 사람 먼저 · POST · COMMENT 빼고) · 채우기 함수 · 엔진 CHECK 에 TM · 자동 번역 배치 앞(sfxTmApply · FORCE 건너뜀 · TM_REUSED) · sfx.tm off · 보관 365 · 서버 · 메뉴 관 관리 · 화면 SFX-030 · 문서 686 · 판 v10.548',
   'CREATE TABLE IF NOT EXISTS public.sfx_tm' in M85 and 'CONSTRAINT ux_sfx_tm UNIQUE (lang, src_key)' in M85 and 'FUNCTION public.fn_sfx_tm_key(p text)' in M85
   and "regexp_replace(btrim(coalesce(p, '')), '\\s+', ' ', 'g')" in M85 and 'trg_sfx_tm_feed' in M85 and "NEW.target_type IN ('POST', 'COMMENT')" in M85
   and 'FUNCTION public.fn_sfx_tm_backfill(p_limit integer)' in M85 and "CHECK (engine IN ('MANUAL', 'CLAUDE', 'N8N', 'MOCK', 'TM'))" in M85
   and "('sfx.tm', 'off'" in M85 and "('sfx.tm_keep_days', '365'" in M85 and 'export async function sfxTmApply' in TM and "'AUTO_APPROVED', 'TM', now()" in TM
   and "import { sfxTmApply } from '../sfx/tm';" in TR and "if (!force) {" in TR and "'TM_REUSED'" in TR and "TM_REUSED: '번역 메모리에서 씀'" in TW
   and "@Put('tm/:id')" in CT and 'export function SfxTm' in UI and "'admsit')?.tabs, 'i18n-review', ['sfx-tm']" in MN and "{tab === 'sfx-tm' && <SfxTm />}" in AP
   and '"SB-ADM-SFX-030"' in SJ and '열쇠' in doc('686_') and VT >= (10, 548), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    KEYS = ['sfx.tm', 'i18n.auto_translate.enabled', 'agent.enabled', 'agent.monthly_cap_usd', 'i18n.enabled', 'i18n.auto_langs']
    before = {k: getset(k) for k in KEYS}
    en_before = psql("SELECT is_active FROM i18n_langs WHERE code = 'en'")
    LID = 'ffffffff-0000-4000-a000-000000000001'   # seller@x.com 매물(시험 자료 · test_v1104 와 같음)
    keyq = psql("SELECT (fn_sfx_tm_key('  가  나 ' || chr(10) || ' 다 ') = fn_sfx_tm_key('가 나 다'))::text")
    srcs = {f: psql(f"SELECT src FROM fn_i18n_source('LISTING', '{LID}', '{f}')") for f in ('title', 'body')}
    other = psql(f"SELECT count(*) FROM content_translations WHERE target_type = 'LISTING' AND target_id = '{LID}' AND lang = 'en' AND engine NOT IN ('MOCK', 'TM')")
    sid = ''
    try:
        se, sid = mk_staff(f'1548m{stamp % 79}', role=None); consent_ok.agree(se, PW); TM_ = login(se)
        # 꺼짐 — 사람 번역을 넣어도 메모리에 안 들어감
        setting('sfx.tm', 'off', '1548')
        k_t = psql(f"SELECT fn_sfx_tm_key(src) FROM fn_i18n_source('LISTING', '{LID}', 'title')")
        psql(f"INSERT INTO content_translations (target_type, target_id, field, lang, text, source_hash, status, engine) "
             f"SELECT 'LISTING', '{LID}', 'title', 'en', 'TM1548 off', md5(src), 'APPROVED', 'MANUAL' FROM fn_i18n_source('LISTING', '{LID}', 'title') "
             f"ON CONFLICT (target_type, target_id, field, lang) DO NOTHING") if other == '0' else None
        n_off = psql(f"SELECT count(*) FROM sfx_tm WHERE lang = 'en' AND src_key = '{k_t}'")
        # 켬 — 사람 번역(MANUAL · APPROVED) 채움 → 엔진 자동 승인이 덮지 못함
        setting('sfx.tm', 'on', '1548')
        if other == '0':
            psql(f"UPDATE content_translations SET text = 'TM1548 human' WHERE target_type = 'LISTING' AND target_id = '{LID}' AND field = 'title' AND lang = 'en'")
            h1 = psql(f"SELECT origin || '|' || tr_text FROM sfx_tm WHERE lang = 'en' AND src_key = '{k_t}'")
            psql(f"UPDATE content_translations SET text = 'TM1548 machine', engine = 'CLAUDE', status = 'AUTO_APPROVED' WHERE target_type = 'LISTING' AND target_id = '{LID}' AND field = 'title' AND lang = 'en'")
            h2 = psql(f"SELECT origin || '|' || tr_text FROM sfx_tm WHERE lang = 'en' AND src_key = '{k_t}'")
        else:
            h1 = h2 = 'HUMAN|TM1548 human'   # 이 매물에 사람 번역이 이미 있어 이 단언은 건너뜀
        # 본문도 메모리에 넣고(사람) 자동 번역 배치 → 엔진을 부르지 않고 메모리 그대로(TM_REUSED)
        if srcs.get('body'):
            psql(f"INSERT INTO sfx_tm (lang, src_key, src_text, tr_text, origin, from_type) SELECT 'en', fn_sfx_tm_key(src), src, 'TM1548 body', 'HUMAN', 'LISTING' "
                 f"FROM fn_i18n_source('LISTING', '{LID}', 'body') ON CONFLICT (lang, src_key) DO UPDATE SET tr_text = EXCLUDED.tr_text, origin = 'HUMAN', is_active = true")
        prov = call('GET', '/admin/i18n/jobs?size=1', None, TS).get('provider')
        reuse_ok = True
        res = ''
        if other == '0' and prov == 'MOCK':
            psql(f"DELETE FROM content_translations WHERE target_type = 'LISTING' AND target_id = '{LID}' AND lang = 'en' AND engine IN ('MOCK', 'TM', 'CLAUDE', 'MANUAL') AND text LIKE 'TM1548%'")
            for k, v in (('i18n.auto_translate.enabled', 'on'), ('agent.enabled', 'on'), ('agent.monthly_cap_usd', '5'), ('i18n.enabled', 'on'), ('i18n.auto_langs', 'en')):
                setting(k, v, '1548')
            psql("UPDATE i18n_langs SET is_active = true WHERE code = 'en'")
            psql(f"SELECT fn_translation_enqueue('LISTING', '{LID}')")
            for _ in range(3):
                call('POST', '/admin/jobs', {'job': 'translate_jobs'}, TS)
                res = psql(f"SELECT coalesce(result, '') FROM translation_jobs WHERE target_type = 'LISTING' AND target_id = '{LID}' AND lang = 'en'")
                if res:
                    break
            rows = psql(f"SELECT string_agg(field || '=' || engine || '=' || text, ';' ORDER BY field) FROM content_translations WHERE target_type = 'LISTING' AND target_id = '{LID}' AND lang = 'en'")
            hits = psql(f"SELECT coalesce(sum(hits), 0) FROM sfx_tm WHERE lang = 'en' AND tr_text LIKE 'TM1548%'")
            reuse_ok = (res == 'TM_REUSED' and 'title=TM=TM1548 human' in rows and (not srcs.get('body') or 'body=TM=TM1548 body' in rows) and int(hits or 0) >= 1)
        else:
            rows = hits = '(건너뜀)'
        ls = call('GET', '/admin/sfx/tm?q=TM1548', None, TS)
        row = next((x for x in ls.get('rows') or [] if str(x.get('tr', '')).startswith('TM1548')), {})
        tid = row.get('id') or '0'
        ed = call('PUT', f'/admin/sfx/tm/{tid}', {'text': 'TM1548 edited'}, TS)
        en_ = call('PUT', f'/admin/sfx/tm/{tid}', {}, TS)
        off = call('PUT', f'/admin/sfx/tm/{tid}', {'active': False}, TS)
        act = psql(f"SELECT is_active::text || '|' || origin || '|' || tr_text FROM sfx_tm WHERE id = {int(tid) if str(tid).isdigit() else 0}")
        nf = call('PUT', '/admin/sfx/tm/999999999999', {'active': True}, TS)
        mb = call('GET', '/admin/sfx/tm', None, TM_)
        bf_on = call('POST', '/admin/sfx/tm/backfill', {}, TS)
        setting('sfx.tm', 'off', '1548')
        bf_off = call('POST', '/admin/sfx/tm/backfill', {}, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'sfx-tm'")
        ok('② 번역 메모리 — 열쇠 공백 정리 · 꺼짐이면 안 채움 · 사람 번역 채움(HUMAN) · 엔진 자동 승인이 못 덮음 · 자동 번역 배치가 메모리를 씀(TM_REUSED · 엔진 TM · 쓰인 횟수 · MOCK 일 때) · 찾기 · 고치기(HUMAN) · 빈 칸 422 · 끄기 · 없는 줄 404 · 회원 403 · 채우기(켜짐 됨 · 꺼짐 422) · 권한 주소 3',
           keyq == 'true' and n_off == '0' and h1 == 'HUMAN|TM1548 human' and h2 == 'HUMAN|TM1548 human' and reuse_ok
           and row.get('id') and ed.get('origin') == 'HUMAN' and en_.get('code') == 'SFX_TM_NOTHING' and off.get('active') is False and act == 'false|HUMAN|TM1548 edited'
           and nf.get('_err') == 404 and mb.get('_err') == 403 and bf_on.get('ok') is True and bf_off.get('code') == 'SFX_TM_OFF' and rmap == '3',
           f"{keyq} {n_off} {h1} {h2} · {prov} {res} {rows} {hits} · {row.get('id')} {ed.get('origin')} {en_.get('code')} {act} · {nf.get('_err')} {mb.get('_err')} {bf_on.get('ok')} {bf_off.get('code')} {rmap}")
    finally:
        for k, v in before.items():
            setting(k, v if v != '' else None, '1548 되돌림')
        psql(f"UPDATE i18n_langs SET is_active = {'true' if en_before == 't' else 'false'} WHERE code = 'en'")
        psql(f"DELETE FROM translation_jobs WHERE target_type = 'LISTING' AND target_id = '{LID}'")
        psql(f"DELETE FROM content_translations WHERE target_type = 'LISTING' AND target_id = '{LID}' AND lang = 'en' AND (engine IN ('TM', 'MOCK') OR text LIKE 'TM1548%')")
        psql(f"DELETE FROM sfx_tm WHERE tr_text LIKE 'TM1548%' OR created_at >= '{T0}'::timestamptz")
        if sid:
            rm_role(sid, '1548')
        ok('② 되돌림 — 메모리 · 번역 · 작업 줄 지움 · 스위치 처음 값',
           psql("SELECT count(*) FROM sfx_tm WHERE tr_text LIKE 'TM1548%'") == '0' and getset('sfx.tm') == (before['sfx.tm'] or 'off')
           and psql(f"SELECT count(*) FROM translation_jobs WHERE target_type = 'LISTING' AND target_id = '{LID}'") == '0', getset('sfx.tm'))
    if ADMIN_WEB:
        r = admin_page('/#/sfx-tm', lambda pg, seen: seen.update(n=pg.locator('[data-sfx-tm]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 관 관리 › 번역 메모리(수 · 찾기 · 화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
