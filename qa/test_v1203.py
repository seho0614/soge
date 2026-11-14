"""v10.203 시험 — 사용자 설명서를 AI 상담 자료로(D180) · 옛 안내 글 · 운영 권한 고침 · 운영 알림 이름(docs/324)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1203.py

  ① 코드 — help_docs(판만 쌓음) · 설명서 API(공개 · 운영 · SUPER 저장) · AI 지식 묶음에 설명서(따로 2만 자 · 출처 m번호) · /guide/manual(HTML 안 넣음) ·
     이용안내 링크 · 텔레그램 · 낯선 로그인 설정 SUPER · 운영 역할도 모든 기기 로그아웃 · 내 2단계 인증 설정 칸 · 시험 결제 정리 단추 SUPER ·
     운영 알림 이름 21 · 제안 403 문구 · 입점 신청 「중요 설정 바뀜」 · 화면 목록 · 문서 321 ~ 324 · 판
  ② (API · DB) 공개 설명서 = DB 지금 판 · 절 수 · 저장(ADMIN 403 · 2만 자 넘음 422 · 절 없음 422 · 같은 글은 판 안 만듦 · 새 판 · 옛 판 보기 · 원래 글로 되돌림) ·
     판 고치기 · 지우기 막힘 · 옛 안내 글 · 입점 신청 바뀜 알림 · 텔레그램 설정 ADMIN 403 · 운영 전용 계정 모든 기기 로그아웃(옛 증표 무효)
  ③ (화면) 이용안내 링크 · /guide/manual 목차 · 절 #m번호 · 390 · 1280 가로 넘침 없음 · 운영 화면 사용자 설명서(SUPER 저장 단추 · ADMIN 읽기만) · 내 2단계 인증 칸
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
MIG = rd('prisma/migrations/D180_help_manual_ai/migration.sql')
ok('① D180 — help_docs(2만 자 · 판 유일 · 고치기 · 지우기 막는 트리거) · v_help_doc_current · 처음 판 USER_MANUAL · 옛 안내 글은 옛 글 그대로인 줄만 · 입점 신청 「중요 설정 바뀜」',
   'CREATE TABLE IF NOT EXISTS public.help_docs' in MIG and 'char_length(body) BETWEEN 100 AND 20000' in MIG and 'UNIQUE (code, version)' in MIG
   and 'BEFORE UPDATE OR DELETE ON public.help_docs' in MIG and 'CREATE OR REPLACE VIEW public.v_help_doc_current' in MIG
   and "SELECT 'USER_MANUAL', 1, '사용자 설명서', $manual$" in MIG and "WHERE NOT EXISTS (SELECT 1 FROM public.help_docs WHERE code = 'USER_MANUAL')" in MIG
   and "AND answer = '계약서에 양측이 서명하면 성사가 확정되고 정산이 자동으로 신청됩니다. 승인 후 매주 수요일 배치로 지급됩니다.'" in MIG
   and "'admin.mfa_required', 'mall.tenant')" in MIG and 'DROP ' not in MIG.replace('DROP TRIGGER IF EXISTS', ''), '')
HS = rd('src/modules/help/help.service.ts'); HC = rd('src/modules/help/help.controller.ts'); AM = rd('src/app.module.ts')
ok('① 설명서 API — 공개 GET /site/manual · 운영 GET(ADMIN · SUPER) · 옛 판 · 저장 POST(SUPER · 감사 HELP_MANUAL_SAVE · 2만 자 · ### 절 · 같은 글은 판 안 만듦 · 판 번호 잠금) · 모듈 등록',
   "@Get('site/manual')" in HC and "@Controller('api/v1/admin/help')" in HC and "@Roles('SUPER')\n  @Audit('HELP_MANUAL_SAVE', 'SITE')" in HC
   and "@Get('manual/versions/:v')" in HC and 'HelpSectionRefDto' in HC and HC.index('class HelpSectionRefDto') < HC.index('class HelpManualDto')
   and "new PolicyViolation('HELP_TOO_LONG'" in HS and "new PolicyViolation('HELP_NO_SECTION'" in HS and 'pg_advisory_xact_lock' in HS
   and '바뀐 내용이 없어 새 판을 만들지 않았습니다.' in HS and 'export const HELP_MAX_CHARS = 20000;' in HS
   and 'HelpPublicController,' in AM and 'HelpAdminController,' in AM and 'HelpService,' in AM, '')
AC = rd('src/modules/agent/agent-chat.service.ts')
ok('① AI 상담 — 지식 묶음에 사용자 설명서(FAQ · 공지 · 약관 4만 자와 따로 · 2만 자 · [설명서 m번호]) · 출처는 「사용자 설명서 › 절」 · /guide/manual#m번호 · 지시문에 user manual',
   'const MANUAL_MAX = HELP_MAX_CHARS;' in AC and 'FROM v_help_doc_current WHERE code = $1' in AC and '[설명서 ${x.id}]' in AC
   and 'linkHref: `/guide/manual#${x.id}`' in AC and '사용자 설명서 › ' in AC and AC.count('(FAQ, user manual, notices, terms excerpts)') == 2
   and 'FAQ ids or user manual section ids' in AC and AC.index('if (text.length > KNOWLEDGE_MAX)') < AC.index('const [man] = await this.db.query'), '')
PG = rd('site/src/app/guide/manual/page.tsx'); MB = rd('site/src/components/guide/ManualBody.tsx'); GP = rd('site/src/app/guide/page.tsx'); SM = rd('site/src/app/sitemap.ts')
KO = json.loads(rd('site/src/i18n/messages/ko/policy.json') or '{}'); EN = json.loads(rd('site/src/i18n/messages/en/policy.json') or '{}')
ok('① 사용자 웹 — /guide/manual(SB-HOM-ETC-040 · 목차 · 절 #m번호 · HTML 을 넣지 않음) · 이용안내 링크 · 사이트 지도 · 사전 ko · en 같은 열쇠',
   'data-screen="SB-HOM-ETC-040"' in PG and "apiGet<Manual>('/site/manual'" in PG and 'dangerouslySetInnerHTML' not in MB + PG
   and 'id={`m${sec}`}' in MB and 'export const manualChapters' in MB and 'href="/guide/manual" data-guide-manual=""' in GP and "'/guide/manual'" in SM
   and set(KO.get('manual', {})) == set(EN.get('manual', {})) == {'back', 'title', 'updated', 'toc', 'koOnly', 'ai', 'empty'}
   and KO.get('meta', {}).get('manual') and EN.get('meta', {}).get('manual') and KO.get('guide', {}).get('manualLink') and EN.get('guide', {}).get('manualLink'), '')
AS_ = rd('src/modules/admin/admin.service.ts'); PC = rd('src/modules/identity/privacy.controller.ts'); EX = rd('src/common/i18n/server-text.en.ts')
LW = rd('web/src/app/admin/LaunchWatch.tsx'); MM = rd('web/src/app/admin/MyMfa.tsx'); OA = rd('web/src/app/admin/OpsAlerts.tsx'); HM = rd('web/src/app/admin/HelpManual.tsx'); MN = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx')
ok('① 운영 권한 — 텔레그램 대화방 · 하루 요약 · 낯선 로그인 알림 설정 SUPER(403 OPS_PUSH_SETTING_SUPER · 영어 문장) · 모든 기기 로그아웃 운영 역할도 · 시험 결제 정리 단추 SUPER 만',
   ("static readonly OPS_PUSH_KEYS = ['ops.telegram_chat', 'ops.telegram_digest', 'ops.staff_login_alert'];" in AS_
    or "static readonly OPS_PUSH_KEYS = ['ops.telegram_chat', 'ops.telegram_digest', 'ops.staff_login_alert', 'ops.slack_digest'];" in AS_
    or "static readonly OPS_PUSH_KEYS = ['ops.telegram_chat', 'ops.telegram_digest', 'ops.staff_login_alert', 'ops.slack_digest', 'ops.board_retention_days'];" in AS_)   # v10.286 (D213) and "new Forbidden('OPS_PUSH_SETTING_SUPER'" in AS_
   and '"운영 알림 텔레그램 · 낯선 로그인 알림 설정은 최고 관리자(SUPER)만 바꿀 수 있습니다.":' in EX
   and "const ANY_SIGNED_IN = [...MEMBER, 'ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'] as const;" in PC
   and "@Post('me/logout-all')\n  @HttpCode(200)\n  @Roles(...ANY_SIGNED_IN)" in PC
   and "d.stubOrders.length > 0 && tokenRoles().includes('SUPER') && (" in LW, '')
NAMES = ['AGENT_CAP_REACHED', 'AGENT_CHAT_HANDOFF', 'K_VALUE_BREACH', 'LEAD_ASSIGN_FAILED', 'LEAD_CASH_AUTO_FAILED', 'LEAD_UNMATCHED', 'NOTIFY_STUCK',
         'PII_PURGE_FAILED', 'PII_PURGE_MISSED', 'PII_PURGE_OVERDUE', 'POSTING_SUSPENDED', 'PRIVACY_REQUEST_DUE', 'PROMO_EXPIRY_UNNOTIFIED', 'RESTRICTION_ENFORCED',
         'RISK_DETECTED', 'RISK_RULE_BROKEN', 'ROLE_REVIEW_DUE', 'SETTLEMENT_AUDIT_FAILED', 'SUBSCRIPTION_BILLING_FAILED', 'SUBSCRIPTION_BILLING_REVIEW', 'SUBSCRIPTION_CARD_UNUSABLE']
ok('① 운영 화면 — 사용자 설명서 탭(관 관리 · SB-ADM-SIT-090 · SUPER 저장 · 글자 수 · 옛 판) · 내 2단계 인증 설정 칸(SUPER) · 모든 기기 로그아웃 · 운영 알림 한국어 이름 21',
   "['manual', '사용자 설명서']" in MN and "'terms', 'manual', 'i18n'" in MN and "screen: 'SB-ADM-SIT-090'" in MN and "{tab === 'manual' && <HelpManual />}" in APP
   and 'data-help-save=""' in HM and "api('/admin/help/manual', { method: 'POST'" in HM and 'readOnly={!isSuper}' in HM
   and 'data-mfa-setting=""' in MM and "key: 'admin.mfa_required', value: mode" in MM and 'data-logout-all-btn=""' in MM and 'setToken(r.accessToken, r.refreshToken)' in MM
   and all(re.search(rf'\b{n}: \'', OA) for n in NAMES), [n for n in NAMES if not re.search(rf'\b{n}: \'', OA)])
RJ = json.loads(rd('site/src/i18n/messages/ko/request.json') or '{}'); RE_ = json.loads(rd('site/src/i18n/messages/en/request.json') or '{}')
SJ = json.loads(rd('spec/screens.json') or '{}'); SCR = {s['id']: s for s in SJ.get('screens', [])}
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 제안 403 문구(사업자 회원만 → 본인인증 회원) · 화면 목록(설명서 2 · 내 2단계 인증 API) · 문서 321 ~ 324 · VERSION v10.203 이상',
   '사업자' not in json.dumps(RJ, ensure_ascii=False).split('"err403"')[1][:60] and 'business' not in json.dumps(RE_).split('"err403"')[1][:80]
   and SCR.get('SB-ADM-SIT-090', {}).get('apis') == ['GET /admin/help/manual', 'GET /admin/help/manual/versions/{v}', 'POST /admin/help/manual']
   and SCR.get('SB-HOM-ETC-040', {}).get('apis') == ['GET /site/manual'] and 'POST /me/logout-all' in SCR.get('SB-ADM-MFA-010', {}).get('apis', [])
   and all(any(f.startswith(f'{n}_') for f in docs) for n in (321, 322, 323, 324))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 203), rd('VERSION').strip())


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


ADMU, SUPU, MEMU = 't1203adm@x.com', 'admin@x.com', 'buyer@x.com'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    pw = psql(f"SELECT password_hash FROM accounts WHERE email = '{MEMU}'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADMU}', '시험운영1203', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{ADMU}'")
    dig0 = psql("SELECT coalesce((SELECT quote_literal(value) FROM site_settings WHERE key = 'ops.telegram_digest'), 'NULL')")
    ten0 = psql("SELECT coalesce((SELECT quote_literal(value) FROM site_settings WHERE key = 'mall.tenant'), 'NULL')")
    orig = None
    try:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1203', true); INSERT INTO account_roles(account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        roles = psql(f"SELECT string_agg(role, ',' ORDER BY role) FROM account_roles WHERE account_id = '{aid}'")
        for e in (SUPU, ADMU): consent_ok.agree(e, PW)
        tok = {e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken') for e in (ADMU, SUPU)}

        # ② 공개 설명서 = DB 지금 판
        pub = call('GET', '/site/manual')
        cur = psql("SELECT version || '|' || (SELECT count(*) FROM regexp_matches(body, '^###\\s', 'gn')) FROM v_help_doc_current WHERE code = 'USER_MANUAL'")
        orig = pub.get('body')
        ok('② 공개 GET /site/manual — 지금 판 · 본문 · ### 절 목차가 DB 와 같음(m1 부터) · 15,000자 안팎 · 「준비 중」 표시 있음',
           cur == f"{pub.get('version')}|{len(pub.get('sections') or [])}" and (pub.get('sections') or [{}])[0].get('id') == 'm1'
           and 10000 < len(orig or '') <= 20000 and '준비 중' in (orig or ''), f"{cur} · {pub.get('version')} {len(pub.get('sections') or [])} · {len(orig or '')}")

        # ② 저장 — 권한 · 한도 · 절 · 같은 글 · 새 판 · 옛 판 · 되돌림
        am = call('GET', '/admin/help/manual', None, tok[ADMU])
        s1 = call('POST', '/admin/help/manual', {'body': orig}, tok[ADMU])
        s2 = call('POST', '/admin/help/manual', {'body': orig + '\n' + '가' * 6000}, tok[SUPU])
        s3 = call('POST', '/admin/help/manual', {'body': '## 장만 있음\n\n' + '설명 ' * 60}, tok[SUPU])
        s4 = call('POST', '/admin/help/manual', {'body': orig}, tok[SUPU])
        v0 = pub.get('version') or 0
        s5 = call('POST', '/admin/help/manual', {'body': orig + '\n### 시험 절 T1203\n- 시험으로 더한 줄입니다.\n', 'note': '시험 T1203'}, tok[SUPU])
        pub2 = call('GET', '/site/manual')
        old = call('GET', f'/admin/help/manual/versions/{v0}', None, tok[ADMU])
        s6 = call('POST', '/admin/help/manual', {'body': orig, 'note': '시험 T1203 되돌림'}, tok[SUPU])
        pub3 = call('GET', '/site/manual')
        ok('② 저장 — ADMIN 읽기 됨 · 저장 403 · 2만 자 넘음 422 HELP_TOO_LONG · 절 없음 422 HELP_NO_SECTION · 같은 글은 판 안 만듦 · 새 판 → 공개에 바로 · 옛 판 보기 · 원래 글로 새 판',
           (am.get('current') or {}).get('version') == v0 and am.get('maxChars') == 20000 and s1.get('_err') == 403
           and s2.get('_err') == 422 and s2.get('code') == 'HELP_TOO_LONG' and s3.get('_err') == 422 and s3.get('code') == 'HELP_NO_SECTION'
           and s4.get('version') == v0 and '바뀐 내용이 없어' in (s4.get('note') or '')
           and s5.get('version') == v0 + 1 and pub2.get('version') == v0 + 1 and (pub2.get('sections') or [{}])[-1].get('heading') == '시험 절 T1203'
           and old.get('version') == v0 and old.get('body') == orig and s6.get('version') == v0 + 2 and pub3.get('body') == orig,
           f"{s1.get('code')} {s2.get('code')} {s3.get('code')} · {s4.get('version')} {s5.get('version')} {s6.get('version')} · {pub2.get('version')} {pub3.get('version')}")
        g1 = psql("UPDATE help_docs SET note = 'x' WHERE code = 'USER_MANUAL'")
        g2 = psql("DELETE FROM help_docs WHERE code = 'USER_MANUAL'")
        by = psql(f"SELECT created_by = (SELECT id FROM accounts WHERE email = '{SUPU}') FROM help_docs WHERE code = 'USER_MANUAL' ORDER BY version DESC LIMIT 1")
        au = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'HELP_MANUAL_SAVE' AND occurred_at > now() - interval '10 minutes'")
        ok('② 판 고치기 · 지우기 DB 가 막음(HELP_DOC_LOCKED) · 고친 사람 기록 · 감사 기록 HELP_MANUAL_SAVE',
           'HELP_DOC_LOCKED' in g1 and 'HELP_DOC_LOCKED' in g2 and by == 't' and au.isdigit() and int(au) >= 2, f'{g1[:40]} · {g2[:40]} · {by} · {au}')

        # ② 옛 안내 글 · 입점 신청 바뀜 알림
        faq = psql("SELECT answer FROM faqs WHERE question = '소개비는 언제 받나요?'")
        n0 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'SETTING_CHANGED' AND detail->>'key' = 'mall.tenant'")
        psql("UPDATE site_settings SET value = CASE WHEN value = 'on' THEN 'off' ELSE 'on' END WHERE key = 'mall.tenant'")
        psql(f"UPDATE site_settings SET value = {ten0} WHERE key = 'mall.tenant'")
        n1 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'SETTING_CHANGED' AND detail->>'key' = 'mall.tenant'")
        ok('② 옛 안내 글 「수요일 배치」 없음(당사자 직접 지급) · 입점 신청을 바꾸면 「중요 설정 바뀜」 두 번',
           faq and '수요일' not in faq and '직접 지급' in faq and n0.isdigit() and n1.isdigit() and int(n1) - int(n0) == 2, f'{faq[:30]} · {n0} → {n1}')

        # ② 텔레그램 · 낯선 로그인 설정 SUPER
        t1 = call('PATCH', '/admin/site-settings', {'key': 'ops.telegram_digest', 'value': 'off'}, tok[ADMU])
        t2 = call('PATCH', '/admin/site-settings', {'key': 'ops.staff_login_alert', 'value': 'off'}, tok[ADMU])
        t3 = call('PATCH', '/admin/site-settings', {'key': 'ops.telegram_digest', 'value': 'off'}, tok[SUPU])
        ok('② 텔레그램 하루 요약 · 낯선 로그인 알림 설정 — ADMIN 403 OPS_PUSH_SETTING_SUPER(끄기도) · SUPER 는 됨',
           t1.get('_err') == 403 and t1.get('code') == 'OPS_PUSH_SETTING_SUPER' and t2.get('code') == 'OPS_PUSH_SETTING_SUPER' and not t3.get('_err'),
           f"{t1.get('code')} {t2.get('code')} · {t3.get('_err')}")
        psql(f"UPDATE site_settings SET value = {dig0} WHERE key = 'ops.telegram_digest'")

        # ③ 화면
        if SITE:
            from playwright.sync_api import sync_playwright
            out = {}; errs = []
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.goto(SITE + '/guide', wait_until='networkidle', timeout=120000)
                link = pg.evaluate("() => document.querySelector('[data-guide-manual]')?.getAttribute('href') ?? ''")
                for w in (1280, 390):
                    pg.set_viewport_size({'width': w, 'height': 900})
                    pg.goto(SITE + '/guide/manual#m5', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1000)
                    out[w] = pg.evaluate("""() => ({ toc: document.querySelectorAll('[data-manual-toc] a').length,
                      h3: document.querySelectorAll('[data-manual-body] h3[id^=m]').length, m5: !!document.getElementById('m5'),
                      tables: document.querySelectorAll('[data-manual-body] table').length, scripts: document.querySelectorAll('[data-manual-body] script').length,
                      ver: document.querySelector('[data-manual-version]')?.getAttribute('data-manual-version') ?? '',
                      over: document.documentElement.scrollWidth > innerWidth + 1 })""")
                b.close()
            chapters = len(re.findall(r'^## ', orig or '', re.M)); secs = len(re.findall(r'^### ', orig or '', re.M))
            ok('③ 사용자 웹 — 이용안내 「자세한 사용 설명서」 → /guide/manual · 목차 = 장 수 · 절 제목 = 절 수(#m5 있음) · 표 그려짐 · 스크립트 없음 · 1280 · 390 가로 넘침 없음 · 오류 없음',
               link == '/guide/manual' and all(v['toc'] == chapters and v['h3'] == secs and v['m5'] and v['tables'] >= 3 and v['scripts'] == 0 and not v['over'] for v in out.values())
               and out[1280]['ver'] == str(pub3.get('version')) and not errs, f'{link} · {out} · 장 {chapters} 절 {secs} · {errs[:2]}')
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            seen = {}; errs2 = []
            with sync_playwright() as p:
                b = p.chromium.launch()
                for who in (SUPU, ADMU):
                    pg = b.new_page(viewport={'width': 1400, 'height': 1000}); pg.on('pageerror', lambda e: errs2.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', who); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                    pg.goto(ADMIN_WEB + '/#/manual', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    m = pg.evaluate("""() => ({ box: !!document.querySelector('[data-help-manual]'), save: !!document.querySelector('[data-help-save]'),
                       ro: document.querySelector('[data-help-body]')?.readOnly ?? null, count: document.querySelector('[data-help-count]')?.getAttribute('data-help-count') ?? '',
                       vers: document.querySelectorAll('[data-help-versions] tbody tr').length })""")
                    pg.goto(ADMIN_WEB + '/#/my-mfa', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    m['mfa'] = pg.evaluate("() => !!document.querySelector('[data-mfa-setting]') + '|' + !!document.querySelector('[data-logout-all-btn]')")
                    seen[who] = m; pg.close()
                b.close()
            s, a = seen[SUPU], seen[ADMU]
            ok('③ 운영 화면 — 관 관리 › 사용자 설명서: SUPER 저장 단추 · 글자 수 · 판 목록 / ADMIN 읽기만(저장 단추 없음) · 내 2단계 인증: SUPER 설정 칸 · 둘 다 모든 기기 로그아웃 · 오류 없음',
               s['box'] and s['save'] and s['ro'] is False and s['count'].isdigit() and s['vers'] >= 3 and a['box'] and not a['save'] and a['ro'] is True
               and s['mfa'] == 'true|true' and a['mfa'] == 'false|true' and not errs2, f'{seen} · {errs2[:2]}')

        # ② 운영 전용 계정 — 모든 기기 로그아웃(맨 끝: 증표가 바뀜)
        lo = call('POST', '/me/logout-all', {'password': PW}, tok[ADMU])
        old_t = call('GET', '/admin/help/manual', None, tok[ADMU])
        new_t = call('GET', '/admin/help/manual', None, lo.get('accessToken'))
        # 옛 증표는 판 번호가 달라 비로그인으로 봄 → 가드가 403 UNAUTHENTICATED(core/auth.ts)
        ok('② 운영 전용 계정(ADMIN 만) 모든 기기 로그아웃 — 200 · 새 증표로는 됨 · 옛 증표는 비로그인(403 UNAUTHENTICATED)',
           roles == 'ADMIN' and lo.get('ok') is True and lo.get('accessToken') and old_t.get('_err') == 403 and old_t.get('code') == 'UNAUTHENTICATED' and not new_t.get('_err'),
           f"{roles} · {lo.get('ok')} · {old_t.get('_err')} · {old_t.get('code')} · {new_t.get('_err')}")
    finally:
        psql(f"UPDATE site_settings SET value = {ten0} WHERE key = 'mall.tenant'")
        psql(f"UPDATE site_settings SET value = {dig0} WHERE key = 'ops.telegram_digest'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
