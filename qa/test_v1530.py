"""v10.530 (D280 · docs/668) ㊿ 고객센터 · 회원 ③ 메일 문구 템플릿 편집
  ① (코드) 메일 종류 8 = DB 종류 표 · 자리값 검사(서버 = DB 트리거) · 발송하는 곳 7곳 csxMail + 코드 글자 fallback · 알림 메일 틀 · 저장 SUPER · 메뉴 · 화면 ID · 문서
  ② (DB · API) 미리보기 검사 · 저장 SUPER(운영 관리자 403) · 422 · DB 트리거 · 새 판 · 같은 글 409 · 판 기록 고치기 막음 · 기본값 · 409 · 되돌리기 — 문구 · 판 기록 · 설정 되돌림(replica)
  ③ (화면) 회원 › 메일 문구 · 미리보기
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


M80 = migr('D280_')
MR, MT = rd('src/modules/csx/mail-render.ts'), rd('src/modules/csx/mail-templates.ts')
stamp = int(time.time()) % 1000000

codes_src = re.findall(r"^    code: '([A-Z_]+)', name:", MR, re.M)
codes_db = re.findall(r"^  \('([A-Z_]+)', '[^']+', ARRAY\[", M80, re.M)
ok('① 메일 종류 8가지 — 코드 기본 문구 목록 = DB 종류 표(같은 순서) · 자리값 검사(서버 · DB 트리거 같은 규칙)',
   len(codes_src) == 8 and codes_src == codes_db and 'CREATE TRIGGER trg_csx_mail_tpl_guard' in M80
   and "t ~* 'https?://'" in M80 and r"/https?:\/\//i.test(all)" in MR and "regexp_replace(t, '\\{[a-z_]+\\}', '', 'g') ~ '[{}]'" in M80
   and 'CREATE TRIGGER trg_csx_mail_ver_ro' in M80, f'{codes_src} {codes_db}')
SITES = {
    'src/modules/identity/account-security.service.ts': ("csxMail(this.db, 'PW_RESET'", '[소개뱅크] 비밀번호 재설정 안내'),
    'src/modules/partner/consult.service.ts': ("csxMail(this.db, 'CONSULT_OTP'", '[소개뱅크] 상담 신청 인증번호'),
    'src/modules/admin/member-notice-jobs.ts': ("csxMail(db, 'WITHDRAW_GRACE'", '탈퇴 취소는'),
    'src/modules/papi/bulk.ts': ("'PTN_INVITE_NEW' : 'PTN_INVITE_MEMBER'", '파트너센터 직원 초대'),
    'src/modules/acct/payslip.ts': ("csxMail(db, 'PAYSLIP_NOTICE'", '급여명세서가 나왔습니다'),
    'src/modules/prx/adreport.ts': ("csxMail(db, 'AD_REPORT'", '광고 성과 보고서'),
}
miss = [p for p, (a, b) in SITES.items() if a not in rd(p) or b not in rd(p)]
NM = rd('src/common/mail/notify-mail.ts')
ok('① 발송하는 곳 7곳 — 고친 판(csxMail) + 코드 글자는 그대로 fallback · 알림 메일 틀(선택 인자 · 없으면 지금과 같음) · 꺼짐 · 검사 실패 · DB 오류면 코드 글자',
   not miss and 'notifyMailText(r, tpl)' in NM and 'tpl?: { subject: string; body: string } | null' in NM and 'csxNotifyTemplate(this.db)' in NM
   and "r.sw !== 'on'" in MT and 'checkMailTemplate(code, r.subject, r.body).length' in MT and 'return fallback;' in MT, ' '.join(miss))
ok('① 연결 — 저장 · 되돌리기 · 기본값은 SUPER · 메뉴 · 화면 ID · 문서 668 · 판 v10.530',
   "@Put('admin/csx/mail-templates/:code')\n  @Roles('SUPER')" in rd('src/modules/csx/csx.controller.ts') and "['csx-mailtpl', '메일 문구']" in rd('web/src/lib/adminMenu.ts')
   and '"SB-ADM-CSX-030"' in SJ and doc('668_') and VT >= (10, 530), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    CODE = 'PTN_INVITE_MEMBER'
    snap = psql(f"SELECT coalesce(subject, '') || E'\\x1f' || coalesce(body, '') || E'\\x1f' || version || E'\\x1f' || is_custom::text FROM csx_mail_templates WHERE code = '{CODE}'")
    v0 = psql("SELECT coalesce(max(id), 0) FROM csx_mail_template_versions") or '0'
    v0 = int(v0) if v0.isdigit() else 0
    sw0 = getset('csx.mail_templates')
    em, sid = mk_staff('1530', 'ADMIN')
    try:
        if '\x1f' not in snap:
            print('  (메일 문구 표가 없음 — ② 건너뜀)', snap[:80])
        else:
            consent_ok.agree(em, PW)
            TA = login(em)
            lst = call('GET', '/admin/csx/mail-templates', None, TS)
            bad = call('POST', f'/admin/csx/mail-templates/{CODE}/preview', {'subject': '[소개뱅크] {company} 초대 {oops}', 'body': '본문 https://evil.example {company}'}, TS)
            good = call('POST', f'/admin/csx/mail-templates/{CODE}/preview', {'subject': '[소개뱅크] {company} 초대', 'body': '{company} 에서 초대했습니다.'}, TS)
            need = call('POST', '/admin/csx/mail-templates/PW_RESET/preview', {'subject': '[소개뱅크] 재설정', 'body': '링크 없이 보냄'}, TS)
            ok('② 목록 8 · 미리보기 — 모르는 자리값 · 주소 직접 쓰기 걸림 · 보기 값으로 채움 · 꼭 넣을 자리값(PW_RESET {link}) 빠지면 걸림',
               len(lst.get('rows') or []) == 8 and bad.get('ok') is False and any('oops' in p for p in bad.get('problems') or []) and any('http' in p for p in bad.get('problems') or [])
               and good.get('ok') is True and '예시 회사' in ((good.get('preview') or {}).get('subject') or '') and need.get('ok') is False and any('link' in p for p in need.get('problems') or []),
               f"{len(lst.get('rows') or [])} {bad.get('problems')} {good.get('preview')} {need.get('problems')}")
            subj = f'[소개뱅크] {{company}} 직원 초대 t1530-{stamp}'
            body = '{company} 에서 소개뱅크 파트너센터 직원으로 초대했습니다(시험 1530).\n\n(주)한국바이오헬스케어 소개뱅크 사업부'
            adm = call('PUT', f'/admin/csx/mail-templates/{CODE}', {'subject': subj, 'body': body, 'note': '시험 1530'}, TA)
            chk = call('PUT', f'/admin/csx/mail-templates/{CODE}', {'subject': subj, 'body': body + ' {oops}', 'note': '시험 1530'}, TS)
            trg = psql(f"UPDATE csx_mail_templates SET is_custom = true, subject = '[소개뱅크] t1530 {{company}}', body = '{{nope}} 본문' WHERE code = '{CODE}'")
            sv = call('PUT', f'/admin/csx/mail-templates/{CODE}', {'subject': subj, 'body': body, 'note': '시험 1530 저장'}, TS)
            same = call('PUT', f'/admin/csx/mail-templates/{CODE}', {'subject': subj, 'body': body, 'note': '시험 1530 같음'}, TS)
            one = call('GET', f'/admin/csx/mail-templates/{CODE}', None, TS)
            ver = sv.get('version')
            ro = psql(f"UPDATE csx_mail_template_versions SET note = '고침' WHERE code = '{CODE}' AND version = {int(ver or 0)}")
            rs = call('POST', f'/admin/csx/mail-templates/{CODE}/reset', {'note': '시험 1530 기본값'}, TS)
            rs2 = call('POST', f'/admin/csx/mail-templates/{CODE}/reset', {'note': '시험 1530 기본값'}, TS)
            rv = call('POST', f'/admin/csx/mail-templates/{CODE}/revert', {'version': int(ver or 0), 'note': '시험 1530 되돌림'}, TS)
            cur = psql(f"SELECT is_custom::text || '|' || (subject = '{subj.replace(chr(39), chr(39) * 2)}')::text FROM csx_mail_templates WHERE code = '{CODE}'")
            ok('② 저장은 SUPER(운영 관리자 403) · 검사 걸리면 422 CSX_TPL_CHECK · DB 트리거도 막음 · 저장 → 새 판 · 같은 글 409 · 판 기록 고치기 막음',
               adm.get('_err') == 403 and chk.get('code') == 'CSX_TPL_CHECK' and 'CSX_TPL_CHECK' in trg and sv.get('ok') is True and isinstance(ver, int)
               and same.get('code') == 'CSX_TPL_SAME' and one.get('isCustom') is True and (one.get('current') or {}).get('subject') == subj
               and any(v.get('version') == ver and v.get('kind') == 'SAVE' for v in one.get('versions') or []) and 'CSX_IMMUTABLE' in ro,
               f"{adm.get('_err')} {chk.get('code')} {trg[-60:]} {sv} {same.get('code')} {ro[-40:]}")
            ok('② 코드 기본값으로 · 두 번째 409 CSX_TPL_DEFAULT · 지난 판으로 되돌리기(새 판 · 그 글)',
               rs.get('ok') is True and rs2.get('code') == 'CSX_TPL_DEFAULT' and rv.get('ok') is True and rv.get('version', 0) > (ver or 0) and cur == 'true|true',
               f"{rs} {rs2.get('code')} {rv} {cur}")
    finally:
        setting('csx.mail_templates', sw0 or 'off', '1530 되돌림')
        if '\x1f' in snap:
            sj, bd, vv, cu = (snap.split('\x1f') + ['', '', '0', 'false'])[:4]
            q = lambda x: 'NULL' if x == '' else "'" + x.replace("'", "''") + "'"
            psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM csx_mail_template_versions WHERE id > {v0} AND code = '{CODE}'; "
                 f"UPDATE csx_mail_templates SET subject = {q(sj)}, body = {q(bd)}, version = {int(vv or 0)}, is_custom = {cu or 'false'} WHERE code = '{CODE}'; COMMIT;")
        if sid:
            rm_role(sid, '1530')
    if ADMIN_WEB:
        def look(pg, seen):
            seen['rows'] = pg.locator('[data-csx-tpl-row]').count()
            pg.locator('[data-csx-tpl-open="PW_RESET"]').click(); pg.wait_for_timeout(1500)
            pg.locator('[data-csx-tpl-preview]').click(); pg.wait_for_timeout(1500)
            seen['pv'] = pg.locator('[data-csx-tpl-pv="ok"]').count()
        r = admin_page('/#/csx-mailtpl', look)
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 메일 문구(8줄 · 비밀번호 재설정 미리보기 통과 · 화면 오류 없음)', seen.get('rows') == 8 and seen.get('pv') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
