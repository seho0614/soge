"""v10.202 시험 — 머리줄 자격 아이콘(관리자 페이지 · 안심소개 파트너 · 파트너센터 · 소개몰 입점) · 소개몰 입점 신청 스위치(docs/319)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1202.py

  ① 코드 — /me/summary badges(안심 · 제휴 · 판매자 · 입점 켜짐) · /cart-count 가 넘김 · 머리줄 아이콘 4(641px 이상 · title · 휴대폰은 메뉴 줄 글자) ·
     옛 「관리자 페이지」 글자 단추 없음 · 사전 ko · en · 입점 스위치(SUPER · 입점 약관 먼저 · 운영 화면 줄 · 화면 목록) · 문서 · 판
  ② (API) badges 가 DB 와 같음(시험 파트너 intro@x.com · 회원 buyer@x.com) · /cart-count · 입점 켜기 — ADMIN 403 · 약관 게시 전 422 TENANT_TERMS_FIRST · 끄기는 됨
  ③ (화면) 운영 계정 · 시험 파트너 · 회원 × 1440 · 1280 · 390 — 자격대로 아이콘 · 휴대폰은 메뉴 줄 글자 · 가로 넘침 없음 · 운영 화면 입점 신청 줄
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MS = rd('src/modules/me/me.service.ts'); AD = rd('src/modules/identity/auth.dto.ts'); CC = rd('site/src/app/cart-count/route.ts')
ok('① 서버 — /me/summary badges(안심 · 제휴 파트너는 PartnerActorService 한 곳 · 판매자 ACTIVE · PAUSED · mall.tenant) · DTO · /cart-count 가 mal · aff · seller · tenant 로 넘김(역할 이름은 안 넘김)',
   'this.actors.forMember(this.me!), this.actors.affiliate(this.me!)' in MS and "affPartner: aff?.affStatus === 'ACTIVE'" in MS
   and "status IN ('ACTIVE', 'PAUSED')) AS seller" in MS and "key = 'mall.tenant'), 'off') = 'on' AS tenant" in MS
   and 'badges: { malPartner: !!mal, ' in MS
   and 'export class MeBadgesDto' in AD and AD.index('export class MeBadgesDto') < AD.index('export class MeSummaryDto') and '@ApiProperty({ type: MeBadgesDto }) badges!: MeBadgesDto;' in AD
   and 'ops, ...badges }' in CC and 'tenant: b.tenantOn === true' in CC, '')
UH = rd('site/src/components/common/UniHeader.tsx'); CSS = rd('site/src/styles/site-head.css')
KO = json.loads(rd('site/src/i18n/messages/ko.json') or '{}').get('header', {}); EN = json.loads(rd('site/src/i18n/messages/en.json') or '{}').get('header', {})
ok('① 머리줄 — 아이콘 4(data-role-icon admin · mal · aff · shop · title · aria-label) · 판매자면 판매자센터 · 휴대폰은 메뉴 줄 글자(.m-role) · 옛 「관리자 페이지」 글자 단추 없음 · 641px 이상만 · 사전 ko · en',
   all(f'data-role-icon="{k}"' in UH for k in ('admin', 'mal', 'aff', 'shop')) and "st.seller ? '/health/seller/center' : '/health/seller'" in UH
   and 'className="m-only m-role" href="/partner"' in UH and 'className="m-only m-role" href="/go/admin"' in UH and 'sh-pill p sh-adm' not in UH
   and '.sh-hd .sh-nav .m-only.m-role { display: none; }' in CSS and '.sh-hdr .sh-role { display: none; }' in CSS and '.sh-hd.in .sh-hdr .sh-adm { display: none; }' not in CSS
   and all(KO.get(k) and EN.get(k) for k in ('malPartner', 'seller', 'sellerCenter')), f'{KO.get("malPartner")} · {EN.get("seller")}')
AS_ = rd('src/modules/admin/admin.service.ts'); TA_ = rd('web/src/app/admin/HealthTenantApply.tsx'); SJ = rd('spec/screens.json'); EX = rd('src/common/i18n/server-text.en.ts')
ok('① 입점 스위치 — mall.tenant 켜기 SUPER 만(403 TENANT_SETTING_SUPER) · 입점 약관 시행 중이어야(422 TENANT_TERMS_FIRST) · 끄기는 ADMIN 도 · 운영 화면 입점 신청 줄 · 화면 목록 · 영어 문장',
   "key === 'mall.tenant' && (value ?? '').trim() === 'on'" in AS_ and "new Forbidden('TENANT_SETTING_SUPER'" in AS_ and "new PolicyViolation('TENANT_TERMS_FIRST'" in AS_
   and "FROM v_terms_current WHERE code = 'HLT_SELLER'" in AS_ and 'data-tenant-switch=' in TA_ and "key: 'mall.tenant'" in TA_ and "'/health/tenant/config'" in TA_
   and '"GET /health/tenant/config",\n    "PATCH /admin/site-settings",\n    "POST /admin/health/sellers/{id}/approve"' in SJ
   and '"소개몰 입점 신청을 켜는 것은 최고 관리자(SUPER)만 할 수 있습니다.":' in EX, '')
ok('① 문서 · 판 — docs/319 · VERSION v10.202 이상',
   any(f.startswith('319_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 202), rd('VERSION').strip())


# ── ② · ③ ─────────────────────────────────────────────────────────────
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


def cart(tok):
    r = urllib.request.Request(SITE + '/cart-count', headers={'Cookie': f'sgb_at={tok}', 'User-Agent': 'test_v1202'})
    try:
        return json.loads(urllib.request.urlopen(r, timeout=60).read())
    except Exception as e:
        return {'_err': str(e)[:80]}


def truth(email):
    q = psql(f"""SELECT EXISTS (SELECT 1 FROM partners p JOIN businesses b ON b.id = p.business_id
                   LEFT JOIN business_members m ON m.business_id = b.id AND m.account_id = a.id AND m.joined_at IS NOT NULL AND m.removed_at IS NULL
                   WHERE (b.account_id = a.id OR m.account_id IS NOT NULL) AND p.status <> 'NONE')::text || '|' ||
                 EXISTS (SELECT 1 FROM partners p JOIN businesses b ON b.id = p.business_id WHERE b.account_id = a.id AND p.aff_status = 'ACTIVE')::text || '|' ||
                 EXISTS (SELECT 1 FROM hlt_sellers s WHERE s.account_id = a.id AND s.type IN ('TENANT', 'BRAND') AND s.status IN ('ACTIVE', 'PAUSED'))::text
            FROM accounts a WHERE a.email = '{email}'""")
    return [x == 'true' for x in q.split('|')] if q.count('|') == 2 else [None, None, None]


ADMU, SUPU, PARU, MEMU = 't1202adm@x.com', 'admin@x.com', 'intro@x.com', 'buyer@x.com'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    pw = psql(f"SELECT password_hash FROM accounts WHERE email = '{MEMU}'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADMU}', '시험운영1202', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{ADMU}'")
    ten0 = psql("SELECT coalesce((SELECT quote_literal(value) FROM site_settings WHERE key = 'mall.tenant'), 'NULL')")
    hlt = psql("SELECT count(*) FROM v_terms_current WHERE code = 'HLT_SELLER'")
    try:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1202', true); INSERT INTO account_roles(account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        for e in (ADMU, SUPU, PARU, MEMU): consent_ok.agree(e, PW)
        tok = {e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken') for e in (ADMU, SUPU, PARU, MEMU)}

        # ② badges = DB
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'mall.tenant'")
        sp = call('GET', '/me/summary', None, tok[PARU]).get('badges') or {}
        sm = call('GET', '/me/summary', None, tok[MEMU]).get('badges') or {}
        tp, tm = truth(PARU), truth(MEMU)
        cp, cm, cs = cart(tok[PARU]), cart(tok[MEMU]), cart(tok[SUPU])
        ok('② /me/summary badges 가 DB 와 같음(시험 파트너 · 회원) · 입점 꺼짐 · /cart-count 가 같은 값 · 운영 계정 ops · 역할 이름은 안 넘김',
           [sp.get('malPartner'), sp.get('affPartner'), sp.get('seller')] == tp and [sm.get('malPartner'), sm.get('affPartner'), sm.get('seller')] == tm
           and sp.get('tenantOn') is False and tp[1] is True
           and [cp.get('mal'), cp.get('aff'), cp.get('seller'), cp.get('tenant')] == tp + [False] and [cm.get('mal'), cm.get('aff')] == tm[:2]
           and cs.get('ops') is True and 'roles' not in json.dumps(cp), f'{sp} {tp} · {sm} {tm} · {cp} · {cs.get("ops")}')

        # ② 입점 스위치
        s1 = call('PATCH', '/admin/site-settings', {'key': 'mall.tenant', 'value': 'on'}, tok[ADMU])
        s2 = call('PATCH', '/admin/site-settings', {'key': 'mall.tenant', 'value': 'on'}, tok[SUPU])
        s3 = call('PATCH', '/admin/site-settings', {'key': 'mall.tenant', 'value': 'off'}, tok[ADMU])
        ok('② 입점 켜기 — ADMIN 403 TENANT_SETTING_SUPER · SUPER 는 입점 약관 게시 전이면 422 TENANT_TERMS_FIRST(게시돼 있으면 켜짐) · 끄기는 ADMIN 도',
           s1.get('_err') == 403 and s1.get('code') == 'TENANT_SETTING_SUPER'
           and ((hlt == '0' and s2.get('_err') == 422 and s2.get('code') == 'TENANT_TERMS_FIRST') or (hlt != '0' and not s2.get('_err')))
           and not s3.get('_err'), f'{s1.get("code")} · {hlt} {s2.get("_err")} {s2.get("code")} · {s3.get("_err")}')

        # ③ 화면 — 입점 켜짐(DB 로) · 운영 계정 · 시험 파트너 · 회원 × 폭 3
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.tenant'")
        if SITE:
            from playwright.sync_api import sync_playwright
            host = re.sub(r'^https?://', '', SITE).split('/')[0].split(':')[0]
            out = {}; errs = []
            with sync_playwright() as p:
                b = p.chromium.launch()
                for who in (SUPU, PARU, MEMU):
                    for w in (1440, 1280, 390):
                        ctx = b.new_context(viewport={'width': w, 'height': 900})
                        ctx.add_cookies([{'name': 'sgb_at', 'value': tok[who], 'domain': host, 'path': '/'}])
                        pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                        pg.goto(SITE + '/community', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                        out[(who, w)] = pg.evaluate("""() => {
                          const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
                          const icons = [...document.querySelectorAll('[data-uni-header] [data-role-icon]')].filter(vis).map((e) => e.getAttribute('data-role-icon') + ':' + (e.getAttribute('title') || '')).sort();
                          const words = [...document.querySelectorAll('[data-uni-header] .sh-nav .m-role')].filter(vis).map((e) => e.textContent.trim()).sort();
                          const hd = document.querySelector('[data-uni-header]').getBoundingClientRect().height;
                          return { icons, words, over: document.documentElement.scrollWidth > innerWidth + 1, hd: Math.round(hd),
                                   pill: [...document.querySelectorAll('[data-uni-header] .sh-pill')].some((e) => vis(e) && e.textContent.includes('관리자 페이지')) };
                        }""")
                        ctx.close()
                b.close()
            tp = truth(PARU)
            exp = lambda t: sorted((['aff:파트너센터'] if t[1] else []) + (['mal:안심소개 파트너'] if t[0] else []) + [('shop:소개몰 판매자센터' if t[2] else 'shop:소개몰 입점 신청')])
            exp_par, exp_mem = exp(tp), exp(truth(MEMU))
            a14, a12, a39 = out[(SUPU, 1440)], out[(SUPU, 1280)], out[(SUPU, 390)]
            p14, p39, m14, m39 = out[(PARU, 1440)], out[(PARU, 390)], out[(MEMU, 1440)], out[(MEMU, 390)]
            ok('③ 화면 — 운영 계정 1440 · 1280 관리자 아이콘(옛 글자 단추 없음) · 시험 파트너는 자격대로 아이콘 · 회원은 입점 아이콘만 · 휴대폰은 아이콘 없이 메뉴 줄 글자 · 가로 넘침 없음 · 머리줄 한 줄 · 오류 없음',
               'admin:관리자 페이지' in a14['icons'] and 'admin:관리자 페이지' in a12['icons'] and not a14['pill'] and not a12['pill']
               and p14['icons'] == exp_par and m14['icons'] == exp_mem
               and a39['icons'] == [] and p39['icons'] == [] and '관리자 페이지' in a39['words'] and any(x.startswith('소개몰') for x in m39['words'])
               and (not tp[0] or '안심소개 파트너' in p39['words']) and a14['words'] == [] and p14['words'] == []
               and not any(v['over'] for v in out.values()) and a12['hd'] <= 90 and a14['hd'] <= 90 and not errs,
               f'{a14} · {a12["icons"]} {a12["hd"]} · {p14["icons"]} vs {exp_par} · {m14["icons"]} vs {exp_mem} · {a39["words"]} · {p39["words"]} · {m39["words"]} · {[k for k, v in out.items() if v["over"]]} · {errs[:2]}')
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs2 = []
                pg.on('pageerror', lambda e: errs2.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                tabs = pg.evaluate("() => !!document.querySelector('[data-tenant-apply]')")
                h1 = pg.evaluate("() => (document.querySelector('[data-tenant-switch]')?.getAttribute('data-tenant-switch') ?? '') + '|' + !!document.querySelector('[data-tenant-flip]') + '|' + location.hash")
                b.close()
            ok('③ 운영 화면 — 소개몰 정산 › 입점 신청 위 「입점 신청 받기 켜짐」 줄 · SUPER 끄기 단추 · 오류 없음', h1.startswith('on|true|') and not errs2, f'{tabs} · {h1} · {errs2[:2]}')
    finally:
        psql(f"UPDATE site_settings SET value = {ten0} WHERE key = 'mall.tenant'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
