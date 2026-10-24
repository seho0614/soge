"""v10.95 시험 — 다국어 2-1(손님 화면 API · 쿠키 · next-intl · 머리줄 · 바닥줄 · 로그인 · 가입 · docs/153)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] [SITE=http://localhost:15174] python3 -I test_v1095.py

  ① 바탕 — next-intl 4.14.9 고정 · 플러그인 · request.ts(꺼져 있으면 쿠키를 읽지 않음 · 켜진 언어만) · 사전 형식 검사(global.d.ts) · layout 제공자
  ② 사전 — ko · en 키가 같음 · 자리표시({n} 등) · 굵게(<b>) 짝이 같음 · 옮긴 파일 23개에 한글 문자열 없음(주석 제외)
  ③ 서버 — GET /i18n/langs(꺼져 있으면 한국어만) · PUT /me/lang(켜진 언어만) · 화면 레지스트리 연결
  ④ (API · DB · SITE) 꺼짐 → 한국어만 · 영어 저장 422 · 켬 + 영어 → 200 · 사용자 웹이 쿠키 en 으로 영어 · 끄면 쿠키가 있어도 한국어 — 끝나면 되돌림
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB'); API = os.environ.get('API'); SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


pkg = json.loads(rd('site/package.json') or '{}')
ok('① next-intl 4.14.9 고정(^ 없음)', pkg.get('dependencies', {}).get('next-intl') == '4.14.9', str(pkg.get('dependencies', {}).get('next-intl')))
ok('① package-lock 에 next-intl 4.14.9', '"node_modules/next-intl": {\n      "version": "4.14.9"' in rd('site/package-lock.json'), '')
ok('① next.config — 플러그인(src/i18n/request.ts)', "require('next-intl/plugin')('./src/i18n/request.ts')" in rd('site/next.config.js'), '')
R = rd('site/src/i18n/request.ts')
i_en = R.find('if (info.enabled)'); i_ck = R.find('(await cookies())')
ok('① request.ts — 꺼져 있으면 쿠키를 읽지 않음 · 켜진 언어만 · 한국어 바탕에 덮기', 0 < i_en < i_ck and "info.items.some((i) => i.code === c)" in R and ('merge(ko as Dict' in R or 'messagesFor(locale)' in R), '')   # v10.97 — 묶음 파일(messages/index.ts)
ok('① 사전 형식 검사(global.d.ts — Messages: typeof ko)', ('Messages: typeof ko;' in rd('site/src/i18n/global.d.ts') or 'Messages: typeof KO;' in rd('site/src/i18n/global.d.ts')), '')   # v10.97
L = rd('site/src/app/layout.tsx')
ok('① layout — NextIntlClientProvider · html lang={locale} · 제목 · 설명은 사전', ('<NextIntlClientProvider locale={locale} messages={messages}>' in L or '<NextIntlClientProvider locale={locale} messages={pick(messages, GLOBAL_NS)}' in L) and '<html lang={locale}>' in L and "getTranslations('meta')" in L, '')

ko = json.loads(rd('site/src/i18n/messages/ko.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en.json') or '{}')


def flat(d, p=''):
    out = {}
    for k, v in d.items():
        out.update(flat(v, p + k + '.') if isinstance(v, dict) else {p + k: v})
    return out


fk, fe = flat(ko), flat(en)
ok('② ko · en 키가 같음', set(fk) == set(fe) and len(fk) > 250, f'{len(fk)} · {len(fe)} · 다름 {sorted(set(fk) ^ set(fe))[:5]}')
ph = [k for k in fk if sorted(re.findall(r'\{(\w+)\}', fk[k])) != sorted(re.findall(r'\{(\w+)\}', fe.get(k, '')))]
ok('② 자리표시 짝이 같음({n} · {name} · {year} …)', not ph, ' '.join(ph[:5]))
bt = [k for k in fk if fk[k].count('<b>') != fe.get(k, '').count('<b>') or fe.get(k, '').count('<b>') != fe.get(k, '').count('</b>')]
ok('② 굵게(<b>) 짝이 같음', not bt, ' '.join(bt[:5]))
ok('② 영어 사전에 한글 없음', not [k for k, v in fe.items() if re.search('[가-힣]', v)], '')
FILES = ['site/src/components/common/SiteHeader.tsx', 'site/src/components/common/HdNav.tsx', 'site/src/components/HdAuth.tsx', 'site/src/components/Footer.tsx',
         'site/src/components/b2/Frame.tsx', 'site/src/components/b2/AuthArea.tsx', 'site/src/components/b2/Notice.tsx', 'site/src/components/home/Frame.tsx',
         'site/src/components/home/HomeLogout.tsx', 'site/src/app/login/page.tsx', 'site/src/app/login/forgot/page.tsx', 'site/src/app/login/reset/page.tsx',
         'site/src/components/auth/LoginForm.tsx', 'site/src/components/auth/PasswordForms.tsx', 'site/src/app/signup/page.tsx', 'site/src/components/auth/SignupWizard.tsx',
         'site/src/components/auth/signup/StepType.tsx', 'site/src/components/auth/signup/StepBiz.tsx', 'site/src/components/auth/signup/StepPerson.tsx',
         'site/src/components/auth/signup/StepTerms.tsx', 'site/src/components/auth/signup/StepProfile.tsx', 'site/src/components/auth/signup/rules.ts',
         'site/src/app/layout.tsx']


def strip_comments(t):
    t = re.sub(r'\{/\*[\s\S]*?\*/\}', '', t)
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    return re.sub(r'(^|[^:\'"`])//[^\n]*', r'\1', t)


left = {f: re.findall(r'[가-힣][^\n]{0,30}', strip_comments(rd(f))) for f in FILES}
left = {f: v for f, v in left.items() if v}
ok(f'② 옮긴 파일 {len(FILES)}개에 한글 문자열 없음(주석 제외)', not left and all(rd(f) for f in FILES), ' | '.join(f'{os.path.basename(f)}: {v[0]}' for f, v in list(left.items())[:3]))
ok('② 한국어일 때 관 이름은 서버 이름(다른 언어만 사전)', all("locale !== 'ko' && isGwanKey(g.code)" in rd(f) for f in ('site/src/components/common/SiteHeader.tsx', 'site/src/components/b2/Frame.tsx', 'site/src/components/home/Frame.tsx')), '')
ok('② 언어 단추 — 꺼짐이면 그리지 않음(LangPick · LangAuto) · b2 는 꺼짐이면 옛 「KR · 준비 중」 그대로', "if (!info.enabled || info.items.length < 2) return null;" in rd('site/src/i18n/LangPick.tsx')
   and 'j?.enabled && Array.isArray(j.items) && j.items.length > 1' in rd('site/src/i18n/LangAuto.tsx') and "<summary aria-label={t('langNow')}>KR {chev}</summary>" in rd('site/src/components/b2/Frame.tsx'), '')

C = rd('src/modules/i18n/i18n.controller.ts'); S = rd('src/modules/i18n/i18n.service.ts')
ok('③ GET i18n/langs(공개) · PUT me/lang(회원)', "@Get('i18n/langs')" in C and "@Put('me/lang')" in C and 'LANG_NOT_ACTIVE' in S and "items.filter((x) => x.code === 'ko')" in S, '')
scr = {x['id']: x for x in json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens']}
ok('③ 화면 레지스트리 — 메인 · 로그인에 GET /i18n/langs · 로그인 메인에 PUT /me/lang', all('GET /i18n/langs' in scr.get(i, {}).get('apis', []) for i in ('SB-HOM-MAIN-011', 'SB-HOM-MAIN-010', 'SB-HOM-AUT-010'))
   and 'PUT /me/lang' in scr.get('SB-HOM-MAIN-010', {}).get('apis', []), '')


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def call(method, path, tok=None, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {tok}'} if tok else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            st, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        st, raw = e.code, e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js


def page(path, cookie=''):
    req = urllib.request.Request(SITE + path, headers={'Cookie': cookie} if cookie else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8', 'replace')


if API and DB:
    login = lambda e: call('POST', '/auth/login', body={'email': e, 'password': 'sgb-dev-1234'})[1]['accessToken']
    MEM = login(os.environ.get('MEMBER', 'person@x.com'))
    _, before, _e = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    try:
        psql("UPDATE site_settings SET value='off' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=false WHERE code='en';")
        s1, j1 = call('GET', '/i18n/langs')
        ok('④ 꺼짐 — 한국어만', s1 == 200 and j1['enabled'] is False and [x['code'] for x in j1['items']] == ['ko'], f'{s1} {j1}')
        s2, j2 = call('PUT', '/me/lang', MEM, {'lang': 'en'})
        s2b, _ = call('PUT', '/me/lang', None, {'lang': 'ko'})
        ok('④ 영어가 꺼져 있으면 저장 422 · 로그인 안 하면 막힘(401 · 403)', s2 == 422 and (j2 or {}).get('code') == 'LANG_NOT_ACTIVE' and s2b in (401, 403), f'{s2} {s2b}')
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        s3, j3 = call('GET', '/i18n/langs')
        s4, j4 = call('PUT', '/me/lang', MEM, {'lang': 'en'})
        rc, pl, _ = psql("SELECT preferred_lang FROM accounts WHERE email = '" + os.environ.get('MEMBER', 'person@x.com') + "'")
        ok('④ 켬 + 영어 — 목록 ko · en · 저장 200 · accounts.preferred_lang = en', s3 == 200 and [x['code'] for x in j3['items']] == ['ko', 'en'] and s4 == 200 and pl == 'en', f'{s3} {s4} {pl}')
        if SITE:
            subprocess.run(['docker', 'restart', 'sgb-site'], capture_output=True)   # 사용자 웹의 /i18n/langs 캐시(60초)를 비움
            import time
            for _ in range(60):
                try:
                    page('/login'); break
                except Exception:
                    time.sleep(3)
            h = page('/login', 'sgb_lang=en')
            ok('④ 사용자 웹 — 쿠키 en → 영어(<html lang="en"> · 제목 · 머리줄 · 본문 · 언어 단추)', '<html lang="en"' in h and '<title>Log in · SogaeBank</title>' in h and 'Sign up free' in h
               and 'Keep me logged in' in h and 'data-lang-pick' in h, '')
            h2 = page('/login')
            ok('④ 사용자 웹 — 쿠키 없으면 한국어 · 언어 단추 보임', '<html lang="ko"' in h2 and '로그인 상태 유지' in h2 and 'data-lang-pick' in h2, '')
            hs = page('/signup', 'sgb_lang=en')
            ok('④ 가입 화면 영어 — 단계 · 유형 설명', '1. Choose your member type' in hs and 'Member type' in hs and 'Start right away without a business registration' in hs, '')
            psql("UPDATE site_settings SET value='off' WHERE key='i18n.enabled';")
            subprocess.run(['docker', 'restart', 'sgb-site'], capture_output=True)
            for _ in range(60):
                try:
                    page('/login'); break
                except Exception:
                    time.sleep(3)
            h3 = page('/login', 'sgb_lang=en')
            ok('④ 끄면 쿠키 en 이 있어도 한국어 · 언어 단추 없음', '<html lang="ko"' in h3 and '로그인 상태 유지' in h3 and 'data-lang-pick' not in h3, '')
    finally:
        en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en'; "
             "UPDATE accounts SET preferred_lang = NULL WHERE email = '" + os.environ.get('MEMBER', 'person@x.com') + "';")
        if SITE:
            subprocess.run(['docker', 'restart', 'sgb-site'], capture_output=True)

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.95 이상', _v >= (10, 95), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
