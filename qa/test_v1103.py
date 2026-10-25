"""v10.103 시험 — 다국어 3-1 운영 글 번역을 손님 화면에(D117 · docs/161)

  KIT=… [API=http://localhost:13000/api/v1] [SITE=http://localhost:15174] [DB=postgresql://sgb:sgb@localhost:15432/sgb] python3 -I test_v1103.py

  ① 마이그레이션 D117 — 대상에 분류 이름(CATEGORY) · 소개몰 상품(HLT_PRODUCT) · 원문 함수 · 손님 화면 색인 · 155 · 마지막 D117
  ② 코드 — 요청 언어(X-Lang · 쿠키) · overlay(승인 · 낡지 않은 줄만) · 사용자 웹이 X-Lang 을 보냄(한국어면 안 보냄) · 원문 목록 API · 약관 「참고용 번역」
  ③ (API · DB) 분류 · FAQ 번역을 넣고 승인 → 꺼짐이면 원문 · 켬 + en 만 번역 · 한국어 요청은 원문 · 원문을 고치면 낡음 → 원문 · 끝나면 되돌림
  ④ (SITE) 켬 — 사용자 웹 한국어 · 영어를 번갈아 열어도 섞이지 않음(캐시)
"""
import json, os, re, subprocess, time, urllib.error, urllib.parse, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE'); DB = os.environ.get('DB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D117_i18n_content_overlay/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 155 · 마지막 D117(v10.104 부터 D118 · 156 — test_v1104)', (len(mig), mig[-1] if mig else '') in ((155, 'D117_i18n_content_overlay'), (156, 'D118_i18n_auto_translate'), (157, 'D119_i18n_board_on_view')), f'{len(mig)} · {mig[-1] if mig else ""}')
ok('① 대상 CATEGORY · HLT_PRODUCT · 원문 함수(분류 id · 상품 코드) · 손님 화면 색인',
   "'CATEGORY','HLT_PRODUCT'" in M and "WHEN 'CATEGORY' THEN IF p_field = 'name'" in M and "WHEN 'HLT_PRODUCT' THEN IF p_field IN ('name','summary')" in M
   and 'idx_content_translations_live' in M, '')

S = rd('src/modules/i18n/i18n.service.ts')
ok('② 서비스 칸 목록 = D117(CATEGORY name · HLT_PRODUCT name · summary)', "CATEGORY: ['name'], HLT_PRODUCT: ['name', 'summary']" in S, '')
ok('② overlay — 승인 · 자동 승인 · 기계 번역만 · 낡음 · 원문 없음 제외 · 켜진 언어만',
   "const LIVE = ['APPROVED', 'AUTO_APPROVED', 'MACHINE']" in S and 'NOT is_stale AND NOT source_missing' in S and 'this.live.enabled && this.live.langs.has(lang)' in S, '')
ok('② 요청 언어 — X-Lang 또는 쿠키 sgb_lang · 한국어는 없음', "req.headers['x-lang']" in rd('src/core/context.middleware.ts') and "s !== 'ko'" in rd('src/core/context.middleware.ts'), '')
ok('② 사용자 웹 — 한국어가 아닐 때만 X-Lang', "if (lang && lang !== 'ko' && /^[a-z]{2}$/.test(lang)) headers['X-Lang'] = lang;" in rd('site/src/lib/api.ts'), '')
ok('② 원문 목록 API(운영) · 운영 화면 「원문 목록」 탭', "@Get('admin/i18n/catalog')" in rd('src/modules/i18n/i18n.controller.ts') and '원문 목록' in rd('web/src/app/admin/Translations.tsx'), '')
ok('② 약관 — 번역이 얹히면 「참고용 번역」(translated)', 'translated?: boolean' in rd('site/src/components/terms/TermsViewer.tsx') and 'viewer.refTranslation' in rd('site/src/components/terms/TermsViewer.tsx'), '')
SRC = '\n'.join(rd(p) for p in ('src/modules/public/public.service.ts', 'src/identity/auth.service.ts', 'src/modules/identity/auth.service.ts',
                                 'src/modules/catalog/catalog.service.ts', 'src/modules/health/health-catalog.service.ts', 'src/modules/listing/listing.service.ts'))
ok('② 손님 화면 API 에 얹음 — 공지 · FAQ · 약관 · 분류 · 소개몰 상품', all(f"'{t}'" in SRC for t in ('NOTICE', 'FAQ', 'TERM', 'CATEGORY', 'HLT_PRODUCT')), '')


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        return {'_err': e.code, 'body': e.read().decode('utf-8', 'replace')[:200]}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip()


def restart_site():
    subprocess.run(['docker', 'restart', 'sgb-site'], capture_output=True)
    for _ in range(80):
        try:
            urllib.request.urlopen(SITE + '/login', timeout=30).read(); return
        except Exception:
            time.sleep(3)


if API and DB:
    T = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    cat = call('GET', '/categories?gwanCode=MNY')[0]
    faq = call('GET', '/admin/i18n/catalog?targetType=FAQ&lang=en&size=1', t=T)['items'][0]
    ok('③ 원문 목록 — FAQ 줄 · 칸 상태', faq.get('targetId') and [f['field'] for f in faq['fields']] == ['question', 'answer'], faq.get('label', ''))
    TAG = 'T1103'
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    oldq = psql(f"SELECT question FROM faqs WHERE id = '{faq['targetId']}'")
    ids = []
    try:
        for tt, tid, fld, txt in (('CATEGORY', cat['id'], 'name', f'{TAG} category'), ('FAQ', faq['targetId'], 'question', f'{TAG} question?')):
            r = call('PUT', '/admin/i18n/translations', {'targetType': tt, 'targetId': tid, 'field': fld, 'lang': 'en', 'text': txt}, t=T)
            ids.append(r.get('id'))
            a = call('POST', f"/admin/i18n/translations/{r.get('id')}/approve", t=T)
            ok(f'③ {tt} 번역 넣기 → 승인', r.get('status') == 'DRAFT' and a.get('status') == 'APPROVED', f'{r} {a}')
        def names(h=None):
            c = [x['name'] for x in call('GET', '/categories?gwanCode=MNY', h=h) if x['id'] == cat['id']]
            f = [x['question'] for x in call('GET', '/faq?channel=FAQ', h=h) if TAG in x['question'] or x['question'] == oldq]
            return (c[0] if c else None, f[0] if f else None)
        psql("UPDATE site_settings SET value='off' WHERE key='i18n.enabled';")
        time.sleep(31)
        ok('③ 꺼짐 — en 요청에도 원문', names({'X-Lang': 'en'}) == (cat['name'], oldq), str(names({'X-Lang': 'en'})))
        psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
        time.sleep(31)   # overlay 설정 기억(30초)
        ok('③ 켬 + X-Lang en → 승인된 번역', names({'X-Lang': 'en'}) == (f'{TAG} category', f'{TAG} question?'), str(names({'X-Lang': 'en'})))
        ok('③ 켬 + 쿠키 sgb_lang=en → 승인된 번역(브라우저가 직접 부를 때)', names({'Cookie': 'sgb_lang=en'})[0] == f'{TAG} category', '')
        ok('③ 켬 + 한국어 요청 → 원문', names() == (cat['name'], oldq), str(names()))
        ok('③ 켬 + 꺼진 언어(ja) → 원문', names({'X-Lang': 'ja'}) == (cat['name'], oldq), '')
        psql(f"UPDATE faqs SET question = question || ' (고침)' WHERE id = '{faq['targetId']}';")
        f2 = [x['question'] for x in call('GET', '/faq?channel=FAQ', h={'X-Lang': 'en'}) if x['question'].startswith(oldq)]
        ok('③ 원문을 고치면 낡음 → 원문이 나감', f2 == [oldq + ' (고침)'], str(f2))
        if SITE:
            restart_site()
            seen = []
            for _ in range(2):
                for ck in ('', 'sgb_lang=en'):
                    h = urllib.request.urlopen(urllib.request.Request(SITE + '/money', headers={'Cookie': ck} if ck else {}), timeout=90).read().decode('utf-8', 'replace')
                    seen.append((ck, f'{TAG} category' in h, cat['name'] in h))
            # 영어 화면의 번역 글자는 사용자 웹 캐시(분류 목록 5분) 안의 것일 수 있어 「한국어 원문이 섞이지 않음」으로 봄 · docs/161 §3-1
            ok('④ 사용자 웹 — 한국어 · 영어를 번갈아 열어도 섞이지 않음(한국어는 원문 · 영어에는 원문 없음)', all((not ko_) if c else (ko_ and not en) for c, en, ko_ in seen), str(seen))
    finally:
        psql(f"UPDATE faqs SET question = $q${oldq}$q$ WHERE id = '{faq['targetId']}';")
        psql(f"DELETE FROM content_translations WHERE text LIKE '{TAG}%' OR text LIKE 'EN-%-TEST%';")   # 손으로 넣어 본 줄도
        en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en';")
        if SITE: restart_site()
        ok('③ 끝나면 되돌림 — 원문 · 번역 줄 · 스위치', psql(f"SELECT question FROM faqs WHERE id = '{faq['targetId']}'") == oldq
           and psql(f"SELECT count(*) FROM content_translations WHERE text LIKE '{TAG}%'") == '0', before)

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.103 이상', _v >= (10, 103), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
