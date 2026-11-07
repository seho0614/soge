"""v10.210 (D187 · docs/335) — 동네 인증(GPS) 켜기 전 안전장치 · 준비 상태

  ① (코드) D187 신고번호 설정 · 켜기 막는 트리거(약관 게시 · 시행 · 신고번호) · 준비 상태 API(ADMIN · SUPER) · 운영 화면 칸 · 영어 · 명세 · 문서 335
  ② (DB) 약관 없이 켜기 막힘 · 신고번호 없이 막힘 · 둘 다 있으면 켜짐(시험용 약관 · 거래 안에서 되돌림)
  ③ (API) SUPER 가 켜기 → 422 INVALID_SETTING · 준비 상태(약관 초안 빈칸 · 신고번호 없음) · 회원 403
  ④ (화면) 소개광장 검수 큐 맨 위 「동네 인증 준비 상태」
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D187_town_verify_guard/migration.sql')
ok('① D187 — 신고번호 설정(비어 있음) · off → on 때만 검사 · 약관 게시 · 시행 · 신고번호 · SETTING: · 지우는 문장 없음',
   "('community.lbs_report_no', NULL," in M and "OLD.value IS DISTINCT FROM 'on'" in M
   and "code = 'LOCATION' AND status = 'PUBLISHED' AND effective_from <= now()" in M and "'SETTING: 동네 인증은 위치기반서비스사업 신고번호(community.lbs_report_no)를 넣은 뒤에 켤 수 있습니다.'" in M
   and 'BEFORE INSERT OR UPDATE ON public.site_settings' in M and not re.search(r'\b(DROP TABLE|TRUNCATE|DELETE FROM)\b', M), '')
SV, C, W, CM = rd('src/modules/community/town-verify.service.ts'), rd('src/modules/community/town-verify.controller.ts'), rd('web/src/app/admin/TownReadiness.tsx'), rd('web/src/app/admin/Community.tsx')
EN, SC = rd('src/common/i18n/server-text.en.ts'), rd('spec/screens.json')
ok('① 준비 상태 API(ADMIN · SUPER · 신고번호 값은 안 내보냄 · 초안 빈칸) · 운영 화면 칸 · 영어 2줄 · 명세',
   "@Get('admin/community/town-verify/readiness')" in C and "reportNo: { set: report }" in SV and r"/〔[^〕]*〕/g" in SV
   and 'data-town-ready' in W and '<TownReadiness />' in CM and '"동네 인증은 위치기반서비스 이용약관(LOCATION)을 게시해 시행된 뒤에 켤 수 있습니다.":' in EN
   and '"GET /admin/community/town-verify/readiness"' in SC, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('335_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 335 · 판 v10.210 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 210), f'{DOC} · {rd("VERSION").strip()}')


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


SUPU = 'admin@x.com'; BUY = 'buyer@x.com'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    s0 = psql("SELECT value FROM site_settings WHERE key = 'community.town_verify'")
    try:
        mig = psql("SELECT count(*) FROM schema_migrations WHERE name = 'D187_town_verify_guard'")
        rn = psql("SELECT coalesce(value, '∅') FROM site_settings WHERE key = 'community.lbs_report_no'")
        loc = psql("SELECT count(*) FROM terms WHERE code = 'LOCATION' AND status = 'PUBLISHED' AND effective_from <= now()")
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'community.town_verify'")
        a1 = psql("UPDATE site_settings SET value = 'on' WHERE key = 'community.town_verify'")
        a2 = psql("BEGIN; INSERT INTO terms (code, version, title, body, is_required, effective_from, status) "
                  "VALUES ('LOCATION', '9.9-qa', '시험', '시험 약관', false, now() - interval '1 minute', 'PUBLISHED'); "
                  "UPDATE site_settings SET value = 'on' WHERE key = 'community.town_verify'; ROLLBACK;")
        a3 = psql("BEGIN; INSERT INTO terms (code, version, title, body, is_required, effective_from, status) "
                  "VALUES ('LOCATION', '9.9-qa', '시험', '시험 약관', false, now() - interval '1 minute', 'PUBLISHED'); "
                  "UPDATE site_settings SET value = '제2026-시험-0001호' WHERE key = 'community.lbs_report_no'; "
                  "UPDATE site_settings SET value = 'on' WHERE key = 'community.town_verify'; "
                  "SELECT value FROM site_settings WHERE key = 'community.town_verify'; ROLLBACK;")
        a4 = psql("BEGIN; INSERT INTO terms (code, version, title, body, is_required, effective_from, status) "
                  "VALUES ('LOCATION', '9.9-qa', '시험', '시험 약관', false, now() + interval '1 day', 'PUBLISHED'); "
                  "UPDATE site_settings SET value = '제2026-시험-0001호' WHERE key = 'community.lbs_report_no'; "
                  "UPDATE site_settings SET value = 'on' WHERE key = 'community.town_verify'; ROLLBACK;")
        ok('② D187 적용 · 신고번호 비어 있음 · 약관 없이 막힘 · 신고번호 없이 막힘 · 시행 전 약관 막힘 · 둘 다 있으면 켜짐(되돌림)',
           mig == '1' and rn == '∅' and loc == '0' and a1.startswith('!') and '약관(LOCATION)을 게시해' in a1 and a2.startswith('!') and '신고번호' in a2
           and a3 == 'on' and a4.startswith('!') and '약관(LOCATION)을 게시해' in a4
           and psql("SELECT value FROM site_settings WHERE key = 'community.town_verify'") == 'off',
           f'{mig} · {rn} · {loc} · {a1[:50]} · {a2[:50]} · {a3} · {a4[:40]}')

        consent_ok.agree(SUPU, PW); consent_ok.agree(BUY, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
        sw = call('PATCH', '/admin/site-settings', {'key': 'community.town_verify', 'value': 'on'}, TS)
        rd_ = call('GET', '/admin/community/town-verify/readiness', None, TS)
        mb = call('GET', '/admin/community/town-verify/readiness', None, TB)
        holes = ((rd_.get('terms') or {}).get('draft') or {}).get('holes') or []
        ok('③ SUPER 켜기 → 422 INVALID_SETTING · 준비 상태(꺼짐 · 약관 없음 · 초안 2.0 빈칸 · 신고번호 없음 · 켤 수 없음) · 회원 403',
           sw.get('_err') == 422 and sw.get('code') == 'INVALID_SETTING' and rd_.get('switchOn') is False and (rd_.get('terms') or {}).get('published') is False
           and '〔보관 기간〕' in holes and rd_.get('reportNo') == {'set': False} and rd_.get('canTurnOn') is False and rd_.get('ready') is False and mb.get('_err') == 403,
           f'{sw.get("_err")} {sw.get("code")} · {str(rd_)[:160]} · {mb.get("_err")}')

        errs, seen = [], {}
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/community', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['h'] = pg.evaluate("() => document.querySelector('[data-town-ready] h3')?.textContent ?? ''")
                seen['rows'] = pg.evaluate("() => [...document.querySelectorAll('[data-town-ready-row]')].map(e => e.getAttribute('data-town-ready-row') + ':' + e.getAttribute('data-ok')).join(',')")
                seen['holes'] = pg.evaluate("() => document.querySelector('[data-town-holes]')?.getAttribute('data-town-holes') ?? ''")
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:120])
        ok('④ 화면 — 소개광장 「동네 인증 준비 상태」 · 약관 ✗ · 신고번호 ✗ · 초안 빈칸 · 오류 없음',
           '동네 인증 준비 상태' in seen.get('h', '') and 'terms:n' in seen.get('rows', '') and 'report:n' in seen.get('rows', '') and seen.get('holes', '') not in ('', '0') and not errs,
           f'{seen} · {errs[:2]}')
    finally:
        if s0 and not s0.startswith('!') and s0 != 'on': psql(f"UPDATE site_settings SET value = '{s0}' WHERE key = 'community.town_verify'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
