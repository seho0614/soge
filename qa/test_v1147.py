"""v10.147 시험 — 메일 · 알림톡 준비 전 안내(docs/226 2절) · 운영 적용 절차서 docs/226 · 신청 묶음 docs/227

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1147.py

  ① 코드 — API 2개(공개 · 신청과 같은 기준) · DTO · 화면 3곳(안내 · 단추 막기 · 못 읽으면 막지 않음) · 사전 ko/en · 화면 목록 · 문서 · 판
  ② (API) 로그인 없이 200 · 모양(ready · byPhone · byMail) · 점검판(개발 환경)은 ready=true
  ③ (사용자 웹) 점검판에서는 안내가 없고 단추가 살아 있음 — /consult · /login/forgot
"""
import json, os, re, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
CS = rd('src/modules/partner/consult.service.ts'); CC = rd('src/modules/partner/consult.controller.ts')
AS = rd('src/modules/identity/account-security.service.ts'); AC = rd('src/modules/identity/account-security.controller.ts')
ok('① 상담 — GET /consult/ready · 신청과 같은 기준(알림톡 · 메일 · 개발 환경) · DTO',
   "@Get('ready')" in CC and 'class ConsultReadyDto' in CC and 'async readiness()' in CS
   and 'byPhone || byMail || devMode' in CS and CC.index('class ConsultReadyDto') < CC.index('export class ConsultController'), '')
ok('① 비밀번호 — GET /auth/password/forgot/ready · forgot 과 같은 기준 · DTO 가 컨트롤러 앞',
   "@Get('auth/password/forgot/ready')" in AC and 'class ForgotReadyDto' in AC and 'async forgotReady()' in AS
   and 'this.mail.ready()) || AccountSecurityService.devMode()' in AS
   and AC.index('class ForgotReadyDto') < AC.index('export class AccountSecurityController'), '')
ok('① 공개 API — @Roles 를 붙이지 않음',
   not re.search(r"@Roles\([^)]*\)\s*\n\s*@Get\('ready'\)", CC) and not re.search(r"@Roles\([^)]*\)\s*\n\s*@Get\('auth/password/forgot/ready'\)", AC), '')
CF = rd('site/src/app/consult/ConsultForm.tsx'); PF = rd('site/src/components/auth/PasswordForms.tsx')
CP = rd('site/src/app/consult/page.tsx'); AP = rd('site/src/app/mal/consult/[code]/apply/page.tsx'); FP = rd('site/src/app/login/forgot/page.tsx')
ok('① 상담 화면 — 안내 · 두 단추 막기 · 두 페이지가 ready 를 넘김 · 못 읽으면 막지 않음(catch → true)',
   'data-consult-not-ready' in CF and CF.count('|| !ready}') == 2 and "ready = true" in CF
   and all("'/consult/ready'" in x and '.catch(() => true)' in x and 'ready={ready}' in x for x in (CP, AP)), '')
ok('① 비밀번호 찾기 — 안내 · 고객센터 링크 · 단추 막기 · 페이지가 ready 를 넘김',
   'data-forgot-not-ready' in PF and 'disabled={pending || !ready}' in PF and "'/auth/password/forgot/ready'" in FP
   and 'ready={ready}' in FP and '.catch(() => true)' in FP, '')
M = {l: json.loads(rd(f'site/src/i18n/messages/{l}.json') or '{}') for l in ('ko', 'en')}
MC = {l: json.loads(rd(f'site/src/i18n/messages/{l}/consult.json') or '{}') for l in ('ko', 'en')}
ok('① 사전 ko · en — pwForm.notReady · consult.form.notReady · 영어에 operator 없음',
   all(M[l].get('pwForm', {}).get('notReady') and MC[l].get('form', {}).get('notReady') for l in ('ko', 'en'))
   and 'operator' not in (M['en']['pwForm']['notReady'] + MC['en']['form']['notReady']).lower(), '')
scr = {s['id']: s for s in json.loads(rd('spec/screens.json') or '{}').get('screens', [])}
ok('① 화면 목록 — 상담 2곳 · 비밀번호 찾기에 API 연결',
   all('GET /consult/ready' in scr.get(i, {}).get('apis', []) for i in ('SB-MAL-CSL-010', 'SB-MAL-CSL-030'))
   and 'GET /auth/password/forgot/ready' in scr.get('SB-HOM-AUT-040', {}).get('apis', []), '')
docs = os.listdir(os.path.join(K, 'docs'))
D226 = next((rd('docs/' + d) for d in docs if d.startswith('226_')), ''); D227 = next((rd('docs/' + d) for d in docs if d.startswith('227_')), '')
ok('① docs/226 — 마이그레이션 14 · 180 · 스냅샷 v10-147 · READY 2줄 · 화면 확인 22 ~ 24',
   '적용 14 · 기존 166 · 변경감지 0' in D226 and '180 / 180' in D226 and 'sgb-before-v10-147' in D226
   and 'READY:2' in D226 and '| 24 |' in D226 and 'v10_145' not in D226, '')
ok('① docs/227 — 발신 IP · 웹훅 3개 · returnurl · 키 이름(연동 키 칸과 같음)',
   '3.37.95.217' in D227 and all(f'/api/v1/webhooks/{w}' in D227 for w in ('toss', 'esign', 'safenum'))
   and '/verify/return' in D227 and all(k in D227 for k in ('NICE_CLIENT_ID', 'ALIMTALK_SENDER_KEY', 'ESIGN_WEBHOOK_SECRET', 'SAFENUM_WEBHOOK_SECRET', 'TOSS_CLIENT_KEY')), '')
D141 = rd('prisma/migrations/D141_safenum/migration.sql')
ok('① docs/227 의 키 이름이 모두 연동 키 칸(D141 제약)에 있음',
   all(f"'{k}'" in D141 for k in re.findall(r'\b(NICE_CLIENT_ID|NICE_CLIENT_SECRET|NICE_PRODUCT_ID|BANK_VERIFY_KEY|TOSS_SECRET_KEY|TOSS_CLIENT_KEY|ALIMTALK_KEY|ALIMTALK_SENDER_KEY|ESIGN_API_KEY|ESIGN_WEBHOOK_SECRET|SAFENUM_KEY|SAFENUM_WEBHOOK_SECRET|NTS_SERVICE_KEY|ETAX_KEY|BROKER_LOOKUP_KEY|SMTP_USER|SMTP_PASS)\b', D227)), '')
ok('① 판 v10.147 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 147), rd('VERSION').strip())


# ── ② API ────────────────────────────────────────────────────────────
def get(p):
    try:
        return json.load(urllib.request.urlopen(API + p, timeout=60))
    except urllib.error.HTTPError as e:
        return {'_err': e.code}


if API:
    r = get('/consult/ready')
    ok('② GET /consult/ready — 로그인 없이 · ready · byPhone · byMail · 점검판 ready=true',
       isinstance(r, dict) and r.get('ready') is True and isinstance(r.get('byPhone'), bool) and isinstance(r.get('byMail'), bool), str(r))
    r = get('/auth/password/forgot/ready')
    ok('② GET /auth/password/forgot/ready — 로그인 없이 · 점검판 ready=true', r == {'ready': True}, str(r))

# ── ③ 사용자 웹 ───────────────────────────────────────────────────────
if SITE:
    def page(p):
        try:
            return urllib.request.urlopen(SITE + p, timeout=120).read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            return f'HTTP {e.code}'
    h = page('/consult')
    ok('③ /consult — 준비됨이면 안내 없음 · 신청서 있음', 'data-consult-not-ready' not in h and 'data-csl-submit' in h, '')
    h = page('/login/forgot')
    ok('③ /login/forgot — 준비됨이면 안내 없음 · 폼 있음', 'data-forgot-not-ready' not in h and 'data-forgot-form' in h, '')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
