"""v10.156 시험 — 운영 화면 「약관」 게시 · AI 켜기 조건을 「국외 이전 조항이 든 처리방침 게시」로(D149 · docs/237)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1156.py

  ① 코드 — D149(함수 · 설명만 고침 · 지우는 문장 없음 · 187) · 서버 잠금 · 안내판 · postcheck 가 같은 함수 · 게시 API(〔미확정〕 · 〔시행일〕 · 보관) ·
     운영 화면(TermsPanel · SiteInfo) · AgentSwitches 글 · docs/237 · docs/236 sha256 · 판
  ② (DB · 거래 안에서 되돌림) fn_privacy_ai_ready — 국외 이전 제목 줄이 든 처리방침이 게시돼야 true · 판 번호와 상관없음 · 초안은 셈하지 않음
  ③ (API) 국외 이전 조항을 잠시 가림 → AI 전체 422 PRIVACY_FIRST · 안내판 TERMS 미달 → 되살리면 1.0 이어도 켜짐 · 되돌림
  ④ (API) 약관 게시 — 9.9 시험 판: 〔미확정〕 → 422 TERM_HOLES · 과거 날짜 422 · ADMIN 403 · 게시 → 〔시행일〕 채움 · 앞 판 보관 · 보관된 판 게시 422 TERM_ARCHIVED · 되돌림
  ⑤ (운영 화면) 법정 고지 › 약관 — 줄 · 처리방침 국외 이전 조항 · 본문 보기 · 시행일 · 게시 단추
"""
import datetime, json, os, re, subprocess, urllib.error, urllib.request
os.environ['PGOPTIONS'] = (os.environ.get('PGOPTIONS', '') + ' -c sgb.terms_fix=on').strip()   # v10.157 D150 — 이 시험은 점검판의 게시된 처리방침을 잠시 고쳤다 되돌림

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D149_privacy_ai_ready/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D149 — fn_privacy_ai_ready(게시된 처리방침 · 국외 이전 제목 줄) · 설명만 고침 · 지우는 문장 없음 · 187 이상',
   'CREATE OR REPLACE FUNCTION public.fn_privacy_ai_ready() RETURNS boolean' in D and "code = 'PRIVACY' AND status = 'PUBLISHED'" in D
   and "body ~ '(^|\\n)#{1,4}[^\\n]*국외 이전'" in D and D.count('UPDATE public.site_settings') == 1 and "WHERE key = 'agent.require_privacy'" in D and 'SET value' not in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', D) and len(mig) >= 187 and 'D149_privacy_ai_ready' in mig, f'{len(mig)} · {mig[-1]}')
AS = rd('src/modules/admin/admin.service.ts'); AG = rd('src/modules/agent/agent.service.ts'); PC = rd('deploy/aws/postcheck.sh')
ok('① 같은 판단 — 서버 잠금(PRIVACY_FIRST) · 안내판(TERMS) · postcheck 가 fn_privacy_ai_ready() · 판 번호(ARRAY[1,1])는 서버 · 안내판에서 빠짐',
   'public.fn_privacy_ai_ready() AS ok' in AS.split('private async checkAiSwitch')[1] and 'public.fn_privacy_ai_ready() AS privacy' in AG
   and 'SELECT public.fn_privacy_ai_ready()::int' in PC and 'ARRAY[1,1]' not in AS and 'ARRAY[1,1]' not in AG and '국외 이전 조항(AI 고지)이 든 개인정보처리방침' in AS, '')
TS = rd('src/modules/catalog/terms.service.ts'); TC = rd('src/modules/catalog/terms.controller.ts')
ok('① 게시 API — 〔미확정〕(〔시행일〕 뺌) TERM_HOLES · 〔시행일〕 채움 · 보관 TERM_ARCHIVED · 과거 날짜 그대로 · 문서',
   "new PolicyViolation('TERM_HOLES'" in TS and "replace(body, '〔시행일〕', $4)" in TS and "new PolicyViolation('TERM_ARCHIVED'" in TS
   and "filter((m) => m !== '〔시행일〕')" in TS and "'EFFECTIVE_DATE_IN_PAST'" in TS and 'TERM_HOLES' in TC and 'TERM_ARCHIVED' in TC, '')
TP = rd('web/src/app/admin/TermsPanel.tsx'); SI = rd('web/src/app/admin/SiteInfo.tsx'); SW = rd('web/src/app/admin/ailearn/AgentSwitches.tsx')
ok('① 운영 화면 — TermsPanel(목록 · 〔미확정〕 · 국외 이전 조항 · 본문 · 시행일 · 게시 · 확인 창) · SiteInfo 맨 아래 · AgentSwitches 글',
   all(x in TP for x in ("useApi<Term[]>('/admin/terms')", '`/admin/terms/${t.code}/publish`', 'data-terms-panel', 'data-term-row', 'data-term-holes', 'data-term-ai',
                         'data-term-view', 'data-term-publish', 'data-terms-date', 'window.confirm(')) and '<TermsPanel />' in SI
   and '1.1' not in SW.split('data-agent-privacy-gate')[1][:600] and '국외 이전 조항' in SW, '')
D237 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('237_')), '')
D236 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('236_')), '')
ok('① docs/237 · docs/236 sha256', all(x in D237 for x in ('fn_privacy_ai_ready', 'TERM_HOLES', '국외 이전', '하지 말 것', 'PRIVACY|1.0|t|3528'))
   and '34e48ee7a914ea764e6ee2511fa1634c26a1b7c5fee3866a3920975892c62ed7' in D236 and '3eca3ae44e4f84db5150aa4841ba9fe2c8775c2a25d158ed32011fd9d785b5fa' in D236, '')
F238 = next((f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('238_')), '')
D238 = rd('docs/' + F238) if F238 else ''
ok('① docs/238 — 운영 적용 v10.155 → v10.156 · 1 · 187 · 스냅샷 v10-156 · 킷 ~/kits/release · sha256 · 약관 화면 · 하지 말 것',
   not F238 or ('v10.156' in F238 and '`적용됨 186 · 새 킷의 파일 187 · 올릴 것 1 · 바뀐 파일 0`' in D238 and '`적용 1 · 기존 186 · 변경감지 0`' in D238
   and '187 / 187' in D238 and 'sgb-before-v10-156' in D238 and '~/kits/release/' in D238 and '58f57b53f54ad06b1373c91cbb48f3982dabfc08d026ed321546f25b9917c508' in D238
   and '「약관」' in D238 and '하지 말 것' in D238), F238 or '(킷에 아직 없음)')
ok('① 판 v10.156 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 156), rd('VERSION').strip())


# ── ② ~ ④ ────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def tx(*sqls):
    """거래 안에서 돌리고 되돌림 — 마지막 문장의 결과"""
    args = ['psql', DB, '-X', '-q', '-At', '-c', 'BEGIN;']
    for s_ in sqls: args += ['-c', s_]
    args += ['-c', 'ROLLBACK;']
    r = subprocess.run(args, capture_output=True, text=True)
    return [x for x in r.stdout.strip().splitlines() if x][-1:] or [r.stderr.strip()[:120]]


SELLER = 'seller@x.com'
TOK = '국외_T1156_'
CODE = 'MARKETING_NIGHT'
if API and DB:
    print('  점검판 처리방침:', psql("SELECT string_agg(version || ' ' || status || ' ' || (body ~ '(^|\\n)#{1,4}[^\\n]*국외 이전')::text, ' · ' ORDER BY version) FROM terms WHERE code = 'PRIVACY'"))
    # ② 함수 — 거래 안에서
    pub = "UPDATE terms SET body = replace(body, '국외 이전', 'X') WHERE code = 'PRIVACY'"
    a = tx(pub, "SELECT public.fn_privacy_ai_ready();")
    b = tx(pub, "UPDATE terms SET status = 'ARCHIVED' WHERE code = 'PRIVACY' AND status = 'PUBLISHED';",
           "INSERT INTO terms (code, version, title, body, is_required, effective_from, status, display_order) SELECT 'PRIVACY', '7.7', title, E'# 처리방침\\n\\n## 제6조 (국외 이전)\\n본문', is_required, '2026-11-11', 'PUBLISHED', display_order FROM terms WHERE code = 'PRIVACY' LIMIT 1;",
           "SELECT public.fn_privacy_ai_ready();")
    c = tx(pub, "INSERT INTO terms (code, version, title, body, is_required, effective_from, status, display_order) SELECT 'PRIVACY', '9.9', title, E'# 처리방침\\n\\n## 제6조 (국외 이전)\\n본문', is_required, 'infinity', 'LEGAL_REVIEW', display_order FROM terms WHERE code = 'PRIVACY' LIMIT 1;",
           "SELECT public.fn_privacy_ai_ready();")
    d = tx(pub, "UPDATE terms SET body = body || E'\\n본문 속 국외 이전 이라는 말만' WHERE code = 'PRIVACY' AND status = 'PUBLISHED';", "SELECT public.fn_privacy_ai_ready();")
    ok('② fn_privacy_ai_ready — 조항 없음 f · 판 7.7 에 조항 t(판 번호 상관없음) · 초안에만 있으면 f · 제목 줄이 아니면 f · 되돌림',
       a == ['f'] and b == ['t'] and c == ['f'] and d == ['f'] and psql("SELECT count(*) FROM terms WHERE version IN ('7.7', '9.9')") == '0', f'{a} {b} {c} {d}')

    KEYS = ('agent.enabled', 'agent.require_privacy', 'agent.monthly_cap_usd')
    was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    t0 = psql(f"SELECT version || '|' || status || '|' || effective_from::text FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': PW})['accessToken']
    sv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    get = lambda k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'")
    try:
        # ③ AI 켜기 — 조항을 잠시 가림 → 막힘 · 되살리면 켜짐
        mock = call('GET', '/admin/agent/status', t=T_).get('keySource') == 'MOCK'
        pv = psql("SELECT coalesce(max(version), '') FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED'")
        psql(f"UPDATE terms SET body = replace(body, '국외 이전', '{TOK}') WHERE code = 'PRIVACY'")
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'agent.enabled'; UPDATE site_settings SET value = 'on' WHERE key = 'agent.require_privacy';")
        sv('agent.monthly_cap_usd', '5')
        r = sv('agent.enabled', 'on'); ro = call('GET', '/admin/agent/rollout', t=T_)
        st = next((s for s in (ro if isinstance(ro, list) else ro.get('steps') or []) if s.get('code') == 'TERMS'), {})
        ok('③ 국외 이전 조항이 든 처리방침 게시 없음 → AI 전체 422 PRIVACY_FIRST(새 문구) · 안내판 TERMS 미달', mock and r.get('code') == 'PRIVACY_FIRST' and '국외 이전 조항' in (r.get('message') or '')
           and get('agent.enabled') == 'off' and st.get('state') == 'READY', f"게시 {pv or '없음'} · {str(r)[:90]} · {st.get('now')}")
        psql(f"UPDATE terms SET body = replace(body, '{TOK}', '국외 이전') WHERE code = 'PRIVACY'")
        has = psql("SELECT public.fn_privacy_ai_ready()") == 't'
        if has:
            r = sv('agent.enabled', 'on'); ro = call('GET', '/admin/agent/rollout', t=T_)
            st = next((s for s in (ro if isinstance(ro, list) else ro.get('steps') or []) if s.get('code') == 'TERMS'), {})
            ok(f'③ 조항이 든 처리방침 {pv} 게시 → 판 번호와 상관없이 AI 전체 켜짐 · 안내판 TERMS 기준 넘음', r.get('_err') is None and get('agent.enabled') == 'on' and st.get('state') == 'DONE'
               and '국외 이전 조항 있음' in (st.get('now') or ''), f"{str(r)[:80]} · {st.get('now')}")
            sv('agent.enabled', 'off')
        else:
            print('  (점검판에 국외 이전 조항이 든 처리방침 게시가 없음 — 켜짐 확인 건너뜀 · ②가 함수로 확인)')

        # ④ 약관 게시 — 시험 판 9.9
        tomorrow = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2)).strftime('%Y-%m-%d')
        title = psql(f"SELECT title FROM terms WHERE code = '{CODE}' LIMIT 1")
        body_h = '# 시험 약관\n\n제1조 이 약관은 시험용입니다. 〔확인 필요〕 칸이 남아 있습니다.\n\n부칙 이 약관은 〔시행일〕부터 시행합니다.'
        body_ok = body_h.replace('〔확인 필요〕 칸이 남아 있습니다', '빈칸은 없습니다')
        r0 = call('PUT', f'/admin/terms/{CODE}', {'version': '9.9', 'title': title, 'body': body_h}, T_)
        r1 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': '9.9', 'effectiveFrom': tomorrow}, T_)
        ok('④ 〔미확정〕이 남은 판 게시 → 422 TERM_HOLES(그대로 법무 검토)', r0.get('status') == 'LEGAL_REVIEW' and r1.get('code') == 'TERM_HOLES' and '1곳' in (r1.get('message') or '')
           and psql(f"SELECT status FROM terms WHERE code = '{CODE}' AND version = '9.9'") == 'LEGAL_REVIEW', f'{r0} · {str(r1)[:100]}')
        call('PUT', f'/admin/terms/{CODE}', {'version': '9.9', 'title': title, 'body': body_ok}, T_)
        rp = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': '9.9', 'effectiveFrom': '2020-01-01'}, T_)
        ra = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': '9.9', 'effectiveFrom': tomorrow}, TA)
        ok('④ 과거 날짜 422 EFFECTIVE_DATE_IN_PAST · 운영(ADMIN) 403', rp.get('code') == 'EFFECTIVE_DATE_IN_PAST' and ra.get('_err') == 403, f"{rp.get('code')} · {ra.get('_err')}")
        r2 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': '9.9', 'effectiveFrom': tomorrow}, T_)
        row = psql(f"SELECT status || '|' || (body LIKE '%〔시행일〕%')::text || '|' || (body LIKE '%{tomorrow}부터%')::text FROM terms WHERE code = '{CODE}' AND version = '9.9'")
        old = psql(f"SELECT status FROM terms WHERE code = '{CODE}' AND version = '{t0.split('|')[0]}'") if t0 else ''
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'TERM_PUBLISH' AND occurred_at > now() - interval '5 minutes'")
        # v10.161 (D151) — 시행일이 이틀 뒤라 시행 예정: 앞 판은 시행일까지 게시 그대로(전에는 그 자리에서 보관)
        ok('④ 게시 → 9.9 시행 예정 · 본문 〔시행일〕이 날짜로 · 앞 판은 시행일까지 게시 그대로(v10.161) · 남은 오픈 차단 수 · 감사 TERM_PUBLISH', r2.get('status') == 'PUBLISHED' and 'remainingBlockers' in r2
           and (r2.get('scheduled') is True or not t0) and row == 'PUBLISHED|false|true' and (old == 'PUBLISHED' or not t0) and aud not in ('', '0'), f'{str(r2)[:80]} · {row} · 앞 판 {old} · 감사 {aud}')
        r3 = call('PATCH', f'/admin/terms/{CODE}/publish', {'version': t0.split('|')[0], 'effectiveFrom': tomorrow}, T_) if t0 else {}
        ok('④ 이미 게시된 판 다시 게시 → 422 TERM_PUBLISHED(시행일 덮어쓰기 막음 · v10.161)', r3.get('code') == 'TERM_PUBLISHED' or not t0, str(r3)[:100])
    finally:
        for k, v in was.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        psql(f"UPDATE terms SET body = replace(body, '{TOK}', '국외 이전') WHERE code = 'PRIVACY'")
        psql(f"DELETE FROM terms WHERE code = '{CODE}' AND version = '9.9'")
        if t0:
            v0, _, e0 = t0.split('|')
            psql(f"UPDATE terms SET status = 'PUBLISHED', effective_from = '{e0}' WHERE code = '{CODE}' AND version = '{v0}'")
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
    t1 = psql(f"SELECT version || '|' || status || '|' || effective_from::text FROM terms WHERE code = '{CODE}' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
    ok('②~④ 되돌림 — 설정 3개 · 처리방침 본문 · 시험 판 지움 · 앞 판 다시 게시(같은 시행일)', all(get(k) == v for k, v in was.items()) and t1 == t0
       and psql(f"SELECT count(*) FROM terms WHERE body LIKE '%{TOK}%' OR (code = '{CODE}' AND version = '9.9')") == '0', f'{t0} → {t1}')

# ── ⑤ 운영 화면 ───────────────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b_ = p.chromium.launch(); pg = b_.new_page(viewport={'width': 1400, 'height': 1000})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/siteinfo', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-terms-panel]')
            rows = box.locator('[data-term-row]')
            priv = box.locator('[data-term-row^="PRIVACY:"] [data-term-ai]')
            ok('⑤ 법정 고지 › 약관 — 줄 9개 이상 · 처리방침 국외 이전 조항 표시 · 시행일 칸 · 화면 오류 없음',
               box.count() == 1 and rows.count() >= 9 and priv.count() >= 1 and box.locator('[data-terms-date]').count() == 1 and not errs, f'줄 {rows.count()} · 오류 {errs[:1]}')
            first = box.locator('[data-term-view]').first
            if first.count():
                first.click(); pg.wait_for_timeout(500)
            ok('⑤ 본문 보기 → 본문 줄 열림', box.locator('[data-term-body]').count() == 1, '')
            box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1156_terms_panel.png'), full_page=False)
            b_.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
