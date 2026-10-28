"""v10.132 시험 — 규칙 코드 작게 · 법정 표기 영어(상호) · 운영용 메모 고침(docs/198)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1132.py

  ① 코드 — withCodes(괄호째 · 코드 낱말) · CSS · 코드가 든 글 그리는 곳 모두 감쌈 · 「C-07 … 오픈 차단 항목」 손님 글 없음
     · D130(상호를 번역 대상 · 영어 초안 승인 대기) · 168 · 지우는 문장 없음
  ② (사용자 웹) 코드가 든 화면에 작은 코드(.rule-code) · 글자는 그대로 · 한국어 · 영어
  ③ (API · DB) 상호 영어 초안이 승인 대기 · 승인하면 영어 바닥줄에 영어 상호 · 한국어는 원문 — 끝나면 되돌림
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ─────────────────────────────────────────────────────────────
H = rd('site/src/lib/ruleCodes.tsx'); CSS = rd('site/src/styles/site.css')
ok('① withCodes — 괄호째(코드뿐) · 코드 낱말 · 요소 안까지 · CSS 작게 · 옅게',
   'export function withCodes(node: ReactNode' in H and '<small key={`${k}-${i++}`} className="rule-code">' in H and 'cloneElement(el' in H
   and '.rule-code { font-size: .78em; font-weight: 400; color: var(--sgb-ink-3' in CSS, '')
SRC = 'site/src'
users = []
for root, _, files in os.walk(os.path.join(K, SRC)):
    for f in files:
        if f.endswith('.tsx') and 'withCodes(' in open(os.path.join(root, f), encoding='utf-8').read():
            users.append(f)
ok('① 코드가 든 글을 그리는 곳 감쌈(파일 30 이상)', len(users) >= 30, f'{len(users)}개')
pat = re.compile(r'[A-Z]{1,4}-\d{1,3}R?\b')
leak = []
for lang in ('ko', 'en'):
    for fn in [f'site/src/i18n/messages/{lang}.json']:
        d = json.loads(rd(fn))
        for sec in ('footer', 'b2'):
            v = d[sec]['tipMailOrder']
            if 'C-07' in v or '오픈 차단' in v or 'Blocks launch' in v: leak.append(f'{lang}.{sec}')
ok('① 손님 글의 운영용 메모(「C-07 신고 대상 확정. 오픈 차단 항목」) 없음 · 손님 문장으로', not leak, str(leak))
M = rd('prisma/migrations/D130_i18n_company_name/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① D130 — 상호를 번역 대상(SETTING) · 영어 초안 DRAFT · 168 · 지우는 문장 없음',
   (len(mig), mig[-1]) in ((168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign')) and "'footer.company_name') THEN" in M and "'DRAFT', 'MANUAL'" in M
   and 'Korea Biohealthcare Co., Ltd.' in M and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M), f'{len(mig)} · {mig[-1]}')
ok('① API — I18N_SETTING_KEYS 에 상호', "'footer.company_name'];" in rd('src/modules/i18n/i18n.service.ts'), '')
ok('① 판 v10.132 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 132), rd('VERSION').strip())


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


# ── ② 사용자 웹 ────────────────────────────────────────────────────────
if SITE:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 1000})
        pg.goto(SITE + '/request', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
        rc = pg.locator('.rule-code')
        txt = rc.first.inner_text() if rc.count() else ''
        fs = pg.evaluate("() => { const e = document.querySelector('.rule-code'); return e ? [getComputedStyle(e).fontSize, getComputedStyle(e.parentElement).fontSize] : null }")
        ok('② 소개받기 목록 — 「(A-12)」가 작은 글씨(.rule-code) · 본문보다 작음', rc.count() >= 1 and 'A-12' in txt and fs and float(fs[0][:-2]) < float(fs[1][:-2]), f'{txt} · {fs}')
        body = pg.locator('body').inner_text()
        ok('② 글자는 그대로(코드가 화면에서 사라지지 않음)', 'A-12' in body, '')
        b.close()

# ── ③ 상호 영어 ────────────────────────────────────────────────────────
if API and DB:
    name = psql("SELECT value FROM site_settings WHERE key = 'footer.company_name'")
    row = psql("SELECT status || '|' || text FROM content_translations WHERE target_type = 'SETTING' AND target_id = 'footer.company_name' AND lang = 'en'")
    if '한국바이오헬스케어' not in (name or ''):
        ok('③ 점검판 상호가 「한국바이오헬스케어」가 아니라 초안을 넣지 않음(운영 자료에서만)', row == '', f'{name} · {row}')
    else:
        ok('③ 상호 영어 초안 — 승인 대기(DRAFT) · 「Korea Biohealthcare Co., Ltd.」', row.startswith('DRAFT|Korea Biohealthcare Co., Ltd.'), row)
        was = (psql("SELECT value FROM site_settings WHERE key = 'i18n.enabled'"), psql("SELECT is_active::text FROM i18n_langs WHERE code = 'en'"))
        try:
            psql("UPDATE site_settings SET value = 'on' WHERE key = 'i18n.enabled'; UPDATE i18n_langs SET is_active = true WHERE code = 'en';")
            pub0 = call('GET', '/site-settings/public', h={'X-Lang': 'en'}).get('footer.company_name')
            ok('③ 승인 전 — 영어 요청에도 원문(한국어) 상호', pub0 == name, str(pub0))
            T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
            tid = psql("SELECT id FROM content_translations WHERE target_type = 'SETTING' AND target_id = 'footer.company_name' AND lang = 'en'")
            ap = call('POST', f'/admin/i18n/translations/{tid}/approve', t=T_)
            time.sleep(31)   # 손님 화면 번역 설정 기억(30초)
            pub1 = call('GET', '/site-settings/public', h={'X-Lang': 'en'}).get('footer.company_name'); ko1 = call('GET', '/site-settings/public').get('footer.company_name')
            ok('③ 승인하면 영어 요청에 영어 상호 · 한국어는 원문', ap.get('_err') is None and (pub1 or '').startswith('Korea Biohealthcare') and ko1 == name, f'{pub1} / {ko1}')
        finally:
            psql("UPDATE content_translations SET status = 'DRAFT', approved_at = NULL, approved_by = NULL WHERE target_type = 'SETTING' AND target_id = 'footer.company_name' AND lang = 'en';")
            psql(f"UPDATE site_settings SET value = '{was[0]}' WHERE key = 'i18n.enabled'; UPDATE i18n_langs SET is_active = {'true' if was[1] == 'true' else 'false'} WHERE code = 'en';")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
