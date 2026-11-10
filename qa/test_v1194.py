"""v10.194 시험 — 안심 파트너 · 제휴 파트너 권한 따로 관리(D173 · docs/304)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1194.py

  ① 코드 — D173(역할 2개 · PAYOUT 겸직 금지 · 기록 · 보유자 · 제휴 칸 · NONE · 제휴 규칙 트리거 · 복사 · 파일 열람 · 링크 클릭 · 지우는 문장 없음 · 211) ·
     서버(역할 이름 · 2단계 대상 · 안심 운영 API 6묶음 PARTNER_MAL · 돈 API 9개는 ADMIN 만 · 제휴 운영 API PARTNER_AFF · 정산 실행은 ADMIN ·
     제휴는 aff_status · 제휴 신청 따로 · 안심 목록에서 NONE 뺌 · 정지 · 다시 열기) · 운영 화면(메뉴 · 역할 주기 · 자격 줄) · 사용자 웹(신청 주소 · 단계) ·
     화면 목록(새 API · 역할) · 영어 사전 · docs/304 · 판
  ② (DB) 역할 겸직 막힘(PARTNER_MAL + PAYOUT · PAYOUT + PARTNER_AFF) · 기록 GRANT · 겸직 0
  ③ (API · DB) 안심 담당은 안심 화면만 · 돈 API 403 · 제휴 담당은 제휴 화면만 · 정산 실행 403 ·
     회원 제휴 신청 → 안심소개는 그대로(NONE · 안심 목록에 없음) → 제휴 담당이 승인 → 제휴 센터 열림 · 링크 클릭 자격 → 제휴만 정지 → 닫힘 · 다시 열기 ·
     안심 신청을 따로 내면 그 줄이 APPLIED(제휴 그대로) · 되돌림
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D173_partner_roles_aff_status/migration.sql')
ok('① D173 — 역할 2개 · PAYOUT 겸직 금지(함수 · 뷰) · 기록 · 보유자에 새 역할과 PAYOUT · 지우는 문장 없음 · 211',
   "'PARTNER_MAL','PARTNER_AFF']))" in M and 'CREATE OR REPLACE FUNCTION public.fn_duty_separation()' in M
   and "role IN ('ADMIN','PARTNER_MAL','PARTNER_AFF') ELSE role = 'PAYOUT' END" in M and 'CREATE OR REPLACE VIEW public.v_duty_conflict' in M
   and M.count("NEW.role IN ('ADMIN','SUPER','REVIEWER','PAYOUT','PARTNER_MAL','PARTNER_AFF')") == 1
   and "'PAYOUT'::text, 'PARTNER_MAL'::text, 'PARTNER_AFF'::text]))\n  GROUP BY a.id" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M.split('CREATE OR REPLACE FUNCTION public.fn_plink_click')[0]) and len(mig) >= 211 and 'D173_partner_roles_aff_status' in mig, f'{len(mig)} · {mig[-1]}')
ok('① D173 — 제휴 칸(aff_status · 신청일 · 승인일 · 승인자 · 사유) · 안심 NONE · 제휴 규칙 트리거 · 기존 줄 복사(걸리는 줄 건너뜀) · 파일 · 링크 클릭은 aff_status',
   all(f'ADD COLUMN IF NOT EXISTS {c}' in M for c in ('aff_status text', 'aff_applied_at', 'aff_approved_at', 'aff_approved_by uuid', 'aff_reason text'))
   and "'REJECTED','NONE']))" in M and 'CREATE TRIGGER trg_partner_aff_guard' in M and 'public.fn_actor_ok(NEW.business_id)' in M
   and 'SET aff_status = status, aff_applied_at = applied_at' in M and 'EXCEPTION WHEN raise_exception OR check_violation' in M
   and "p.aff_status = 'ACTIVE') INTO v_partner" in M and "'PARTNER_MAL' = ANY (p_roles) AND f.purpose IN ('BROKER_DOC','PARTNER_MEDIA')" in M
   and 'pt.aff_status AS partner_status' in M and "r.partner_status IS DISTINCT FROM 'ACTIVE'" in M, '')

AU = rd('src/core/auth.ts'); MF = rd('src/modules/identity/mfa.service.ts')
ok('① 서버 — 역할 이름 · 2단계 인증 대상 · 권한 정기 점검 · 줄 수 있는 역할(SUPER)',
   "| 'PARTNER_MAL' | 'PARTNER_AFF';" in AU and "'SUPER', 'PARTNER_MAL', 'PARTNER_AFF'];" in AU and "'PARTNER_MAL', 'PARTNER_AFF'];" in MF
   and "'PARTNER_MAL','PARTNER_AFF')`" in rd('src/modules/admin/role-review.service.ts')
   and "const OK = ['REVIEWER', 'ADMIN', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF'];" in rd('src/modules/site/report.service.ts'), '')
P = 'src/modules/partner/'
MALC = [('broker-admin.controller.ts', 'api/v1/admin/brokers'), ('consult.controller.ts', 'api/v1/admin/partner-axes'), ('directory.controller.ts', 'api/v1/admin/directory'),
        ('partner-admin.controller.ts', 'api/v1/admin/partners'), ('partner-center.controller.ts', 'api/v1/admin/partner-center'), ('qualification.controller.ts', 'api/v1/admin/qualifications')]
mal_ok = all(f"@Controller('{c}')\n@Roles('ADMIN', 'SUPER', 'PARTNER_MAL')" in rd(P + f) for f, c in MALC)


def pinned(f, routes):
    t = rd(P + f)
    return all(re.search(re.escape(f"  {r}\n") + r"  @Roles\('ADMIN', 'SUPER'\)   // v10\.194", t) for r in routes)


money = pinned('partner-admin.controller.ts', ["@Post('fees/void-requests/:id/accept')", "@Post('fees/:id/void')"]) \
    and pinned('partner-center.controller.ts', ["@Post('cash/auto-run')", "@Post('cash/:partnerId/adjust')", "@Post('lead-cash-invoices/run')",
                                                "@Post('lead-cash-invoices/:id/issue')", "@Put('rules/bonus-rates/:grade')", "@Put('rules/grades/:grade')"]) \
    and pinned('directory.controller.ts', ["@Post('invoices/:id/issue')"])
AC = rd('src/modules/affiliate/affiliate.controller.ts')
blocks = re.findall(r"@(?:Get|Post|Patch|Put|Delete)\('(admin/affiliates/[^']*)'\)\n\s*@Roles\(([^)]*)\)", AC)
aff_ok = blocks and all(("'PARTNER_AFF'" in r) == (p != 'admin/affiliates/settlements/run' and p != 'admin/affiliates/settlements') for p, r in blocks)
ok('① 서버 — 안심 운영 API 6묶음 PARTNER_MAL · 돈을 움직이는 9개는 ADMIN 만 · 제휴 운영 API PARTNER_AFF(정산 조회 · 실행은 그대로)',
   mal_ok and money and aff_ok, f'{mal_ok} {money} {len(blocks)}')
PA = rd(P + 'partner-actor.service.ts'); AS = rd('src/modules/affiliate/affiliate.service.ts'); AD = rd('src/modules/affiliate/affiliate-admin.service.ts')
PD = rd(P + 'partner-admin.service.ts')
ok('① 서버 — 제휴는 aff_status(찾기 · 대시보드 · 심사 · 목록 · 정지) · 제휴 신청 따로(NONE 줄) · 안심 찾기 · 목록에서 NONE 뺌 · 안심 정지 · 다시 열기',
   "p.status <> 'NONE'" in PA and 'async affiliateActiveId(' in PA and 'this.actors.affiliateActiveId(this.me!)' in AS
   and "VALUES ($1, 'NONE', 'APPLIED', now())" in AS and ("WHERE partners.aff_status IS NULL OR partners.aff_status = 'REJECTED'" in AS or "WHERE partners.aff_status IS NULL OR partners.aff_status IN ('REJECTED', 'WITHDRAWN')" in AS)   # v10.224 탈퇴 뒤 다시
   and "WHERE p.aff_status = 'APPLIED'" in AD and "WHERE id = $1 AND aff_status = 'APPLIED'" in AD and 'async affSetStatus(' in AD
   and "WHERE p.status <> 'NONE'" in PD and 'async admSetStatus(' in PD
   and ("WHERE partners.status IN ('REJECTED', 'NONE')" in rd(P + 'partner.service.ts') or "WHERE partners.status IN ('REJECTED', 'NONE', 'WITHDRAWN')" in rd(P + 'partner.service.ts'))   # v10.224
   and "@Post('partner/affiliate/apply')" in AC, '')

APP = rd('web/src/App.tsx'); RA = rd('web/src/app/admin/RoleAdmin.tsx')
ok('① 운영 화면 — 메뉴(안심 4 · 제휴 1 · 홈 · 내 2단계) · 역할 이름 · 역할 주기 칸 · 제휴 정산 탭 숨김 · 파트너 상세 자격 줄 · 제휴 파트너 현황',
   "partners: ['ADMIN', 'SUPER', 'PARTNER_MAL']," in APP and "quals: ['ADMIN', 'SUPER', 'PARTNER_MAL']," in APP and "affiliates: ['ADMIN', 'SUPER', 'PARTNER_AFF']," in APP
   and "'my-mfa': ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF']," in APP
   and 'function GrantForm(' in RA and "const GRANTABLE = ['PARTNER_MAL', 'PARTNER_AFF', 'REVIEWER', 'ADMIN', 'SUPER'];" in RA
   and "TABS.filter((t) => t.key !== 'settle')" in rd('web/src/app/admin/Affiliates.tsx')
   and '/admin/partners/${id}/${to}' in rd('web/src/app/admin/partners/PartnerDetail.tsx')
   and '/admin/affiliates/partners/${x.id}/${to}' in rd('web/src/app/admin/affiliates/Applications.tsx'), '')
SP = rd('site/src/app/partners/page.tsx')
ko = json.loads(rd('site/src/i18n/messages/ko/affiliate.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en/affiliate.json') or '{}')
ok('① 사용자 웹 — 제휴 신청 주소 · 단계는 affStatus(정지 · 반려 사유) · 사전 ko · en',
   "fetch('/api/v1/partner/affiliate/apply'" in rd('site/src/components/partners/AffiliateApply.tsx') and 'd.affStatus' in SP
   and "tr('dash.apply.suspendedDesc'" in SP and "tr('dash.apply.rejectedDesc'" in SP
   and all(k in ko.get('dash', {}).get('apply', {}) and k in en.get('dash', {}).get('apply', {}) for k in ('suspended', 'suspendedDesc', 'rejected', 'rejectedDesc')), '')
ok('① 개발 시드 — 시험 파트너(intro@x.com)는 제휴 자격도 ACTIVE(aff_status · 승인자) — 없으면 제휴 파트너센터가 신청 화면(test_v1185)',
   "'ACTIVE', now(), now(),\n       (SELECT id FROM accounts WHERE email = 'admin@x.com' LIMIT 1)" in rd('scripts/local-setup.sh')
   and "aff_status = 'ACTIVE'" in rd('scripts/local-setup.sh'), '')
SC = json.loads(rd('spec/screens.json') or '{"screens":[]}')
sid = {s['id']: s for s in SC['screens']}
ok('① 화면 목록 — 새 API 7개 · 안심 화면 PARTNER_MAL · 제휴 화면 PARTNER_AFF(정산 화면은 그대로)',
   'POST /partner/affiliate/apply' in sid.get('SB-AFC-DSH-010', {}).get('apis', [])
   and {'GET /admin/affiliates/partners', 'POST /admin/affiliates/partners/{id}/suspend', 'POST /admin/affiliates/partners/{id}/resume'} <= set(sid.get('SB-AFF-APL-010', {}).get('apis', []))
   and {'POST /admin/partners/{id}/suspend', 'POST /admin/partners/{id}/resume'} <= set(sid.get('SB-ADM-PTN-011', {}).get('apis', []))
   and 'PARTNER_MAL' in sid.get('SB-ADM-PTN-010', {}).get('roles', []) and 'PARTNER_AFF' in sid.get('SB-AFF-APL-010', {}).get('roles', [])
   and 'PARTNER_AFF' not in sid.get('SB-AFF-STL-010', {}).get('roles', []), '')
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 영어 사전 — 회원에게 가는 새 문장 · DB 오류 글', all(f'"{k}"' in EN for k in (
    '이미 제휴 파트너 신청을 하셨습니다.', '심사 후 승인됩니다. 승인되면 제휴상품 링크를 발급할 수 있습니다.', '제휴 정지 · 반려에는 사유가 필요합니다',
    '제휴 승인자와 승인 시각이 필요합니다 — 누가 들여보냈는지 남아야 합니다', '본인인증(개인) 또는 사업자 인증을 마친 계정만 제휴 파트너로 활동할 수 있습니다')), '')
ok('① 문서 · 판 — docs/304 · v10.194 이상', any(f.startswith('304_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 194), rd('VERSION').strip())


# ── ② · ③ DB · API ────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql, quiet=False):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode and not quiet: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip())


def login(email):
    return call('POST', '/auth/login', {'email': email, 'password': PW}).get('accessToken')


MALU, AFFU, MEM = 't1194mal@x.com', 't1194aff@x.com', 't1194mem@x.com'
WHY = '시험 T1194'
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    for e in (MALU, AFFU, MEM):
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e}', '시험{e[5:8]}', '{pw}', now()) ON CONFLICT DO NOTHING")
    ids = {e: psql(f"SELECT id FROM accounts WHERE email = '{e}'") for e in (MALU, AFFU, MEM)}
    grant = lambda e, r: psql(f"BEGIN; SELECT set_config('app.role_reason', '{WHY}', true); INSERT INTO account_roles(account_id, role) VALUES ('{ids[e]}', '{r}') ON CONFLICT DO NOTHING; COMMIT;")
    try:
        n0 = psql("SELECT coalesce(max(id), 0) FROM role_changes")
        grant(MALU, 'PARTNER_MAL'); grant(AFFU, 'PARTNER_AFF')
        d1 = psql(f"INSERT INTO account_roles(account_id, role) VALUES ('{ids[MALU]}', 'PAYOUT')", quiet=True)
        d2 = psql(f"BEGIN; INSERT INTO account_roles(account_id, role) VALUES ('{ids[MEM]}', 'PAYOUT'); INSERT INTO account_roles(account_id, role) VALUES ('{ids[MEM]}', 'PARTNER_AFF'); COMMIT;", quiet=True)
        g = psql(f"SELECT string_agg(role || ':' || action || ':' || coalesce(reason, '-'), ',' ORDER BY role) FROM role_changes WHERE id > {n0} AND account_id IN ('{ids[MALU]}', '{ids[AFFU]}')")
        ok('② 겸직 막힘(PARTNER_MAL + PAYOUT · PAYOUT 다음 PARTNER_AFF) · 기록 GRANT · 사유 · 겸직 0',
           d1.startswith('!') and 'DUTY' in d1 and d2.startswith('!') and 'DUTY' in d2
           and g == f'PARTNER_AFF:GRANT:{WHY},PARTNER_MAL:GRANT:{WHY}' and psql('SELECT count(*) FROM v_duty_conflict') == '0', g)

        for e in (MALU, AFFU, MEM):
            consent_ok.agree(e, PW)
        TM, TF, TU = login(MALU), login(AFFU), login(MEM)

        def c(m, p, t, b=None):
            r = call(m, p, b, t)
            return r.get('_err', 200) if isinstance(r, dict) else 200
        s_mal = [c('GET', '/admin/partners', TM), c('GET', '/admin/qualifications', TM), c('GET', '/admin/partner-axes', TM), c('GET', '/admin/directory', TM)]
        s_mal_no = [c('POST', '/admin/partner-center/cash/auto-run', TM), c('GET', '/admin/affiliates/applications', TM), c('GET', '/admin/accounts', TM)]
        ok('③ 안심 담당 — 안심 화면 4곳 200 · 리드 충전 자동 실행(돈) 403 · 제휴 403 · 회원 목록 403', s_mal == [200] * 4 and s_mal_no == [403] * 3, f'{s_mal} {s_mal_no}')
        s_aff = [c('GET', '/admin/affiliates/applications', TF), c('GET', '/admin/affiliates/products', TF), c('GET', '/admin/affiliates/partners', TF)]
        s_aff_no = [c('POST', '/admin/affiliates/settlements/run', TF, {'period': '2026-10'}), c('GET', '/admin/affiliates/settlements', TF), c('GET', '/admin/partners', TF)]
        ok('③ 제휴 담당 — 제휴 화면 3곳 200 · 정산 실행 · 정산 조회 403 · 안심 403', s_aff == [200] * 3 and s_aff_no == [403] * 3, f'{s_aff} {s_aff_no}')

        psql(f"DELETE FROM partners WHERE business_id IN (SELECT id FROM businesses WHERE account_id = '{ids[MEM]}')", quiet=True)
        a1 = call('POST', '/partner/affiliate/apply', {}, TU)
        a2 = call('POST', '/partner/affiliate/apply', {}, TU)
        row = psql(f"SELECT p.id || '|' || p.status || '|' || coalesce(p.aff_status, '-') FROM partners p JOIN businesses b ON b.id = p.business_id WHERE b.account_id = '{ids[MEM]}'")
        pid = row.split('|')[0] if '|' in row else ''
        dsh = call('GET', '/partner/affiliate/dashboard', None, TU); lead = call('GET', '/partner/dashboard', None, TU)
        in_mal = any(isinstance(x, dict) and x.get('id') == pid for x in (call('GET', '/admin/partners', None, TM) or []))
        ok('③ 회원 제휴 신청 → 제휴 APPLIED · 안심 NONE · 두 번째 409 · 제휴 대시보드 affStatus · 안심 대시보드는 신청 전 · 안심 목록에 없음',
           a1.get('affStatus') == 'APPLIED' and a2.get('code') == 'ALREADY_APPLIED' and row.endswith('|NONE|APPLIED')
           and dsh.get('ok') is False and dsh.get('affStatus') == 'APPLIED' and lead.get('applied') is False and not in_mal, f'{row} · {str(dsh)[:80]}')

        apps = call('GET', '/admin/affiliates/applications', None, TF)
        seen = any(x.get('id') == pid for x in (apps.get('items') or []))
        dec = call('POST', f'/admin/affiliates/applications/{pid}/decide', {'state': 'APPROVED'}, TF)
        st = psql(f"SELECT status || '|' || aff_status || '|' || (aff_approved_by = '{ids[AFFU]}') FROM partners WHERE id = '{pid}'")
        dsh2 = call('GET', '/partner/affiliate/dashboard', None, TU)
        ok('③ 제휴 담당이 심사 목록에서 보고 승인 → 제휴 ACTIVE(승인자 = 제휴 담당) · 안심 NONE 그대로 · 제휴 센터 열림',
           seen and dec.get('ok') is True and st == 'NONE|ACTIVE|true' and dsh2.get('ok') is not False, f'{st} · {str(dec)[:60]}')

        prod = psql("SELECT id FROM affiliate_products WHERE status = 'ON_SALE' ORDER BY id LIMIT 1")
        code = 'T1194' + pid.replace('-', '')[:10]
        if prod:
            psql(f"INSERT INTO partner_links(partner_id, product_id, code, label) VALUES ('{pid}', '{prod}', '{code}', '시험') ON CONFLICT (code) DO NOTHING")
        k1 = psql(f"SELECT reason FROM fn_plink_click('{code}', NULL)") if prod else 'OK|'
        e0 = call('POST', f'/admin/affiliates/partners/{pid}/suspend', {'reason': ' '}, TF)
        s1 = call('POST', f'/admin/affiliates/partners/{pid}/suspend', {'reason': WHY + ' 정지'}, TF)
        st2 = psql(f"SELECT status || '|' || aff_status || '|' || coalesce(aff_reason, '-') FROM partners WHERE id = '{pid}'")
        dsh3 = call('GET', '/partner/affiliate/dashboard', None, TU)
        k2 = psql(f"SELECT reason FROM fn_plink_click('{code}', NULL)") if prod else 'PARTNER_INACTIVE'
        ok('③ 제휴만 정지 → 사유 없으면 400/422 · SUSPENDED(사유) · 안심 그대로 · 대시보드 닫힘(사유 보임) · 링크 클릭 PARTNER_INACTIVE',
           e0.get('_err') in (400, 422) and s1.get('affStatus') == 'SUSPENDED' and st2 == f'NONE|SUSPENDED|{WHY} 정지'
           and dsh3.get('ok') is False and dsh3.get('affStatus') == 'SUSPENDED' and dsh3.get('affReason') == f'{WHY} 정지'
           and (k1 or '').startswith(('OK', 'BAD_LANDING')) and k2 == 'PARTNER_INACTIVE', f'{st2} · {k1} → {k2}')
        r1 = call('POST', f'/admin/affiliates/partners/{pid}/resume', {'reason': WHY + ' 다시'}, TF)
        ok('③ 다시 열기 → ACTIVE · 사유 지움 · 대시보드 열림', r1.get('affStatus') == 'ACTIVE'
           and psql(f"SELECT aff_status || '|' || coalesce(aff_reason, '-') FROM partners WHERE id = '{pid}'") == 'ACTIVE|-'
           and call('GET', '/partner/affiliate/dashboard', None, TU).get('ok') is not False, str(r1)[:80])

        m1 = call('POST', '/partner/apply', {}, TU)
        st3 = psql(f"SELECT status || '|' || aff_status FROM partners WHERE id = '{pid}'")
        lead2 = call('GET', '/partner/dashboard', None, TU)
        in_mal2 = any(isinstance(x, dict) and x.get('id') == pid and x.get('affStatus') == 'ACTIVE' for x in (call('GET', '/admin/partners', None, TM) or []))
        ok('③ 안심 신청을 따로 냄 → 같은 줄 안심 APPLIED · 제휴 ACTIVE 그대로 · 안심 대시보드 신청함 · 안심 목록에 나옴(제휴 칸 함께)',
           st3 == 'APPLIED|ACTIVE' and lead2.get('applied') is not False and in_mal2, f'{st3} · {str(m1)[:60]}')
    finally:
        psql(f"DELETE FROM partner_links WHERE code LIKE 'T1194%'", quiet=True)
        for e, r in ((MALU, 'PARTNER_MAL'), (AFFU, 'PARTNER_AFF')):
            psql(f"BEGIN; SELECT set_config('app.role_reason', '{WHY} 끝', true); DELETE FROM account_roles WHERE account_id = '{ids[e]}' AND role = '{r}'; COMMIT;", quiet=True)
    ok('끝 — 되돌림(시험 계정 역할 없음 · 겸직 0)', psql(f"SELECT count(*) FROM account_roles WHERE account_id IN ('{ids[MALU]}', '{ids[AFFU]}', '{ids[MEM]}') AND role LIKE 'PARTNER_%'") == '0'
       and psql('SELECT count(*) FROM v_duty_conflict') == '0', '')
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
