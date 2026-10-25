"""v10.107 시험 — 다국어 작은 빈칸(docs/166)

  KIT=… [API=http://localhost:13000/api/v1] [DB=postgresql://sgb:sgb@localhost:15432/sgb] [SITE=http://localhost:15174] python3 -I test_v1107.py

  ① 코드 — 업종 이름 응답 출구(CategoryNameInterceptor · 운영 화면 건너뜀 · 정확히 같은 이름만) · 요청 예산 영어 글은 lib/fmt.ts 표 · 나의공간 누적 수익 ₩ · 404 요청마다 그림
  ② (API · DB) 업종 번역 승인 → 영어 요청: 상담 업체 목록 category.name · 검색 업종 후보 name 이 번역 · 한국어 · 꺼짐 · 운영 화면은 원문 · 끝나면 되돌림
  ③ (SITE) 영어 쿠키로 없는 주소 → 영어 404(응답 코드 404) · 한국어는 한국어
"""
import json, os, re, subprocess, time, urllib.error, urllib.parse, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


I = rd('src/modules/i18n/category-name.interceptor.ts')
ok('① 업종 이름 응답 출구 — 등록 · 운영 화면 건너뜀 · 언어 없으면 그대로 · 정확히 같은 이름만 · 실패해도 원문',
   'useClass: CategoryNameInterceptor' in rd('src/app.module.ts') and r'/^\/api\/v1\/admin(\/|\?|$)/' in I and 'if (!lang) return body;' in I
   and 'map.get(x)' in I and "NAME_PARENTS = new Set(['category', 'categories', 'candidates'])" in I and '업종 이름 번역 건너뜀' in I, '')
ok('① 번역 표 — 승인 · 자동 승인 · 낡지 않은 것만 · 60초 기억', 'async categoryNameMap(lang: string)' in rd('src/modules/i18n/i18n.service.ts')
   and "liveOf('CATEGORY')" in rd('src/modules/i18n/i18n.service.ts'), '')
R = rd('site/src/components/request/ReqCard.tsx'); F = rd('site/src/lib/fmt.ts')
ok('① 요청 예산 영어 글 — 화면 코드에서 빼고 lib/fmt.ts 표(EN_WORDS)로', "budgetNego: 'Budget negotiable'" in F and 'EN_WORDS.budgetNego' in R
   and "'Budget negotiable'" not in R and "`Up to ${w(max)}`" not in R, '')
M = rd('site/src/app/my/page.tsx')
ok('① 나의공간 누적 수익 — 다른 언어는 ₩ 앞붙임(KRW 단위 글자 안 씀)', "money: true" in M and "f.won(x.v ?? 0)" in M, '')
G = rd('site/src/components/gwan/gw.ts')
ok('① 업종 그림 — 영어 업종 이름도 그림을 고름(한국어 낱말 뒤 · 대소문자 무시)', "['used car', 'car']" in G and "['cafe', 'cafe']" in G and ".toLowerCase();" in G
   and G.index("['인수', 'mac']") < G.index("['used car', 'car']"), '')
N = rd('site/src/app/not-found.tsx')
ok('① 404 — connection() 으로 요청마다 그림(정적 한국어 아님)', "import { connection } from 'next/server'" in N and 'await connection();' in N, '')


def call(m, p, b=None, t=None, h=None):
    hd = {'content-type': 'application/json', **(h or {})}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=120))
    except urllib.error.HTTPError as e:
        return {'_err': e.code, 'body': e.read().decode('utf-8', 'replace')[:200]}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def page(path, ck=''):
    try:
        r = urllib.request.urlopen(urllib.request.Request(SITE + path, headers={'Cookie': ck} if ck else {}), timeout=90)
        return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


if API and DB:
    T = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    TAG = 'T1107'
    before = psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')")
    cat = next((c for c in call('GET', '/categories?gwanCode=MAL') if c.get('code') == 'CSL_LEGAL'), None)
    ok('② 시험 업종 CSL_LEGAL(법률 상담 · 정액 노출형)', cat, str(cat and cat.get('name')))
    try:
        if cat:
            r = call('PUT', '/admin/i18n/translations', {'targetType': 'CATEGORY', 'targetId': cat['id'], 'field': 'name', 'lang': 'en', 'text': f'{TAG} Legal'}, t=T)
            a = call('POST', f"/admin/i18n/translations/{r.get('id')}/approve", t=T)
            ok('② 업종 번역 넣기 → 승인', a.get('status') == 'APPROVED', str(a))
            dname = lambda h=None: (call('GET', '/consult/directory/CSL_LEGAL', h=h).get('category') or {}).get('name')
            psql("UPDATE site_settings SET value='off' WHERE key='i18n.enabled';")
            time.sleep(31)
            ok('② 다국어 꺼짐 — 영어 요청에도 원문', dname({'X-Lang': 'en'}) == cat['name'], str(dname({'X-Lang': 'en'})))
            psql("UPDATE site_settings SET value='on' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active=true WHERE code='en';")
            time.sleep(62)   # 설정 30초 · 업종 번역 표 60초 기억
            ok('② 켬 + 영어 — 상담 업체 목록 category.name 이 번역', dname({'X-Lang': 'en'}) == f'{TAG} Legal', str(dname({'X-Lang': 'en'})))
            ok('② 켬 + 한국어 — 원문', dname() == cat['name'], str(dname()))
            # 검색 팝업 업종 글자(search/suggest categories)는 누르면 그 글자로 찾으므로 바꾸지 않음(글자 배열은 건드리지 않음) — docs/166
            sg = call('GET', '/search/suggest?q=' + urllib.parse.quote(cat['name'][:2]), h={'X-Lang': 'en'})
            ok('② 검색 팝업 업종 글자는 그대로(누르면 그 글자로 찾음)', f'{TAG} Legal' not in json.dumps(sg, ensure_ascii=False), str(sg.get('categories'))[:120])
            adm = call('GET', '/admin/directory', t=T, h={'X-Lang': 'en'})
            items = adm.get('items', adm) if isinstance(adm, dict) else adm
            hits = [x.get('categoryName') for x in (items or []) if isinstance(x, dict) and x.get('categoryCode') == 'CSL_LEGAL']
            ok('② 운영 화면(/admin) — 영어 요청이어도 원문(한국어 유지)', f'{TAG} Legal' not in json.dumps(adm, ensure_ascii=False), str(hits[:2]))
        if SITE:
            st_en, h_en = page('/no-such-page-v1107', 'sgb_lang=en')
            st_ko, h_ko = page('/no-such-page-v1107')
            en_nf = json.loads(rd('site/src/i18n/messages/en/join.json') or '{}').get('notFound', {}).get('title', '')
            ko_nf = json.loads(rd('site/src/i18n/messages/ko/join.json') or '{}').get('notFound', {}).get('title', '')
            ok('③ 없는 주소 — 영어 쿠키면 영어 404 · 한국어는 한국어 · 응답 코드 404', st_en == 404 and st_ko == 404 and en_nf and en_nf in h_en and ko_nf in h_ko and ko_nf not in h_en.split('<body')[-1],
               f'{st_en}/{st_ko} · en「{en_nf}」 · ko「{ko_nf}」')
    finally:
        psql(f"DELETE FROM content_translations WHERE text LIKE '{TAG}%';")
        en_on, en_act = (before.split(',') + ['off', 'f'])[:2]
        psql(f"UPDATE site_settings SET value='{en_on or 'off'}' WHERE key='i18n.enabled'; UPDATE i18n_langs SET is_active={'true' if en_act == 't' else 'false'} WHERE code='en';")
        ok('② 끝나면 되돌림 — 번역 줄 · 스위치', psql(f"SELECT count(*) FROM content_translations WHERE text LIKE '{TAG}%'") == '0'
           and psql("SELECT (SELECT value FROM site_settings WHERE key='i18n.enabled') || ',' || (SELECT is_active FROM i18n_langs WHERE code='en')") == before, before)

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.107 이상', _v >= (10, 107), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
