"""v10.174 시험 — 검색 노출 기본(robots · sitemap · 공유 미리보기 · 아이콘) · 오류 화면 · 서버 오류 몰림 알림(D163 · docs/268)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1174.py

  ① 코드 — D163(ops.server_error_per_10min ADMIN · 지우는 문장 없음 · 201) · 5xx 세기 · 필터 · 실행기 알림 · 지켜보기 칸 · sitemap-entries ·
     robots · sitemap · 오류 화면 2 · 미리보기 그림 · 아이콘 · layout openGraph · 사전 ko · en · 명세 · docs/268 · 판
  ② (API) sitemap-entries — 공개 매물(켜진 관 · HLT 제외 · PUBLISHED)만 · 글(PUBLISHED · FOOD 아님)만 · 판매 중 상품만 · 제목 · 본문 없음
  ③ (API) 서버 오류 5xx 를 기준 수만큼(점검판 DB 표 이름을 잠깐 바꿔 일으킴 · 곧바로 되돌림) → launch_watch → 운영 알림 SERVER_ERROR_SPIKE · 지켜보기 serverErrorsHour · 기준 되돌림
  ④ (사용자 웹) /robots.txt · /sitemap.xml · og:image 그림 · 아이콘
"""
import json, os, re, subprocess, urllib.error, urllib.parse, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
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
M = rd('prisma/migrations/D163_server_error_watch/migration.sql')
ok('① D163 — ops.server_error_per_10min 20(ADMIN) · 지우는 문장 없음 · 201 이상',
   "('ops.server_error_per_10min', '20', 'ADMIN'," in M and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M)
   and len(mig) >= 201 and 'D163_server_error_watch' in mig, f'{len(mig)} · {mig[-1]}')
CNT = rd('src/common/server-error-count.ts'); FL = rd('src/common/db-error.filter.ts'); LS = rd('src/modules/admin/launch-watch.service.ts')
SH = rd('src/worker/scheduler.service.ts'); WL = rd('web/src/app/admin/LaunchWatch.tsx')
PS = rd('src/modules/public/public.service.ts'); PC = rd('src/modules/public/public.controller.ts')
ok('① 서버 — 5xx 세기(1시간 · 2,000건) · 필터에서 기록 · 10분 기준 · 1시간에 한 번 · 실행기 알림 · 지켜보기 칸 · sitemap-entries(주소 · 시각만)',
   'export function recordServerError' in CNT and 'export function serverErrorsSince' in CNT and 'if (status >= 500) recordServerError(' in FL
   and 'async serverErrorSpike()' in LS and "alert_code = 'SERVER_ERROR_SPIKE' AND raised_at > now() - interval '1 hour'" in LS and 'serverErrorsHour' in LS
   and "'SERVER_ERROR_SPIKE'" in SH and 'serverErrorsHour' in WL and "@Get('site/sitemap-entries')" in PC and 'async sitemapEntries()' in PS
   and "l.status = 'PUBLISHED' AND l.gwan_code <> 'HLT'" in PS and 'FROM gwans WHERE is_active AND NOT is_hub' in PS and "'MNY'" not in PS and "board <> 'FOOD'" in PS, '')
RB = rd('site/src/app/robots.ts'); SM = rd('site/src/app/sitemap.ts'); ER = rd('site/src/app/error.tsx'); GE = rd('site/src/app/global-error.tsx')
OG = rd('site/src/app/opengraph-image.tsx'); IC = rd('site/src/app/icon.tsx'); LY = rd('site/src/app/layout.tsx')
ko = json.loads(rd('site/src/i18n/messages/ko.json') or '{}').get('errorPage', {}); en = json.loads(rd('site/src/i18n/messages/en.json') or '{}').get('errorPage', {})
ok('① 사용자 웹 — robots(개인 화면 빼기 · 사이트 지도) · sitemap(고정 + 공개 주소 · API 실패에도 응답) · 오류 화면 2 · 미리보기 그림 1200×630 · 아이콘 · openGraph · 사전',
   "'/my'" in RB and "'/api/'" in RB and 'sitemap: `${o}/sitemap.xml`' in RB and "'/site/sitemap-entries'" in SM and '.catch(() =>' in SM
   and "useTranslations('errorPage')" in ER and "'use client'" in ER and 'reset()' in ER and '<html' in GE and 'width: 1200, height: 630' in OG
   and 'ImageResponse' in IC and 'openGraph:' in LY and 'metadataBase:' in LY
   and all(k in ko and k in en for k in ('title', 'body', 'retry', 'home', 'support', 'code')), '')
SPEC = rd('spec/screens.json')
ok('① 명세 · 문서 · 판 — GET /site/sitemap-entries · docs/268 · v10.174', '"GET /site/sitemap-entries"' in SPEC
   and any(f.startswith('268_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 174), rd('VERSION').strip())


# ── ② ③ API ──────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read() or b'{}')
        except Exception: body = {}
        return {'_err': e.code, **(body if isinstance(body, dict) else {})}


def psql(sql):
    return subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True).stdout.strip()


def fetch(url, timeout=120):
    try:
        r = urllib.request.urlopen(url, timeout=timeout)
        return r.status, r.headers.get('content-type', ''), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('content-type', ''), b''
    except Exception as e:
        return 0, '', str(e).encode()


if API and DB:
    e = call('GET', '/site/sitemap-entries')
    L, P, H = e.get('listings') or [], e.get('posts') or [], e.get('products') or []
    ids = "','".join(x['id'] for x in L) or '00000000-0000-0000-0000-000000000000'
    pids = "','".join(x['id'] for x in P) or '00000000-0000-0000-0000-000000000000'
    codes = "','".join(x['code'].replace("'", "''") for x in H) or '-'
    bad_l = psql(f"SELECT count(*) FROM listings WHERE id IN ('{ids}') AND (status <> 'PUBLISHED' OR gwan_code = 'HLT' OR gwan_code NOT IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub))")
    bad_p = psql(f"SELECT count(*) FROM posts WHERE id IN ('{pids}') AND (state <> 'PUBLISHED' OR board = 'FOOD')")
    bad_h = psql(f"SELECT count(*) FROM hlt_products WHERE code IN ('{codes}') AND status <> 'ON_SALE'")
    want_l = psql("SELECT count(*) FROM (SELECT 1 FROM listings WHERE status = 'PUBLISHED' AND gwan_code <> 'HLT' AND gwan_code IN (SELECT code FROM gwans WHERE is_active AND NOT is_hub) LIMIT 5000) x")
    leak = any(k in x for x in L + P + H for k in ('title', 'body', 'name', 'author', 'ownerAccountId'))
    ok('② sitemap-entries — 공개 매물 · 글 · 판매 중 상품만 · 제목 · 본문 · 작성자 없음 · 공개 매물 수와 같음',
       isinstance(e.get('listings'), list) and bad_l == '0' and bad_p == '0' and bad_h == '0' and not leak and str(len(L)) == want_l,
       f'매물 {len(L)}/{want_l} · 글 {len(P)} · 상품 {len(H)} · 어긋남 {bad_l}/{bad_p}/{bad_h}')

    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    old = psql("SELECT value FROM site_settings WHERE key = 'ops.server_error_per_10min'") or '20'
    psql("UPDATE site_settings SET value = '3' WHERE key = 'ops.server_error_per_10min'")
    # v10.175 — 빈 글자(%00)는 이제 400 이라 서버 오류를 일으키지 못합니다. 점검판 DB 의 표 이름을 잠깐 바꿔 sitemap-entries 를 500 으로 만들고 곧바로 되돌립니다.
    trig = None
    psql("ALTER TABLE hlt_products RENAME TO hlt_products_t1174")
    try:
        if call('GET', '/site/sitemap-entries').get('_err') == 500:
            trig = '/site/sitemap-entries'
            for _ in range(2): call('GET', trig)
    finally:
        psql("ALTER TABLE hlt_products_t1174 RENAME TO hlt_products")
    j = call('POST', '/admin/jobs', {'job': 'launch_watch'}, T_)
    n10 = (j.get('detail') or {}).get('serverErrors10m', -1)
    al = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'SERVER_ERROR_SPIKE' AND raised_at > now() - interval '1 hour'")
    w = call('GET', '/admin/launch-watch', t=T_)
    psql(f"UPDATE site_settings SET value = '{old}' WHERE key = 'ops.server_error_per_10min'")
    ok('③ 서버 오류 몰림 — 5xx 를 일으킴 · launch_watch 지난 10분 건수 ≥ 기준(3) · 운영 알림 SERVER_ERROR_SPIKE(1시간 안) · 지켜보기 1시간 칸',
       trig and n10 >= 3 and al not in ('', '0') and (w.get('serverErrorsHour') or 0) >= 3, f'일으킨 곳 {trig} · 10분 {n10} · 알림 {al} · 1시간 {w.get("serverErrorsHour")}')
    ok('③ 기준 되돌림 · 회원은 지켜보기 403', psql("SELECT value FROM site_settings WHERE key = 'ops.server_error_per_10min'") == old
       and call('GET', '/admin/launch-watch', t=call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')).get('_err') == 403, old)

    # ── ④ 사용자 웹 ───────────────────────────────────────────────────
    if SITE:
        s1, _, rb = fetch(SITE + '/robots.txt'); rb = rb.decode('utf-8', 'replace')
        ok('④ /robots.txt — 개인 화면 빼기(/my · /api/ · /deal) · 소개광장은 열림 · 사이트 지도 줄',
           s1 == 200 and 'Disallow: /my' in rb and 'Disallow: /api/' in rb and 'Disallow: /deal' in rb and not re.search(r'^Disallow: /community$', rb, re.M)
           and re.search(r'^Sitemap: https?://\S+/sitemap\.xml$', rb, re.M), f'{s1} · {len(rb)}자')
        s2, ct2, sm = fetch(SITE + '/sitemap.xml'); sm = sm.decode('utf-8', 'replace')
        GP = {'MNY': 'money', 'MAL': 'mall', 'BIZ': 'biz'}
        one = f"/{GP[L[0]['gwan']]}/{L[0]['id']}</loc>" if L else '</loc>'
        ok('④ /sitemap.xml — urlset · 메인 · 소개광장 · 공개 매물 주소 · 개인 화면 없음',
           s2 == 200 and '<urlset' in sm and '/community</loc>' in sm and one in sm and '/my' not in sm, f'{s2} · {ct2} · <loc> {sm.count("<loc>")}개')
        s3, _, home = fetch(SITE + '/'); home = home.decode('utf-8', 'replace')
        og = re.search(r'<meta property="og:image" content="([^"]+)"', home)
        ic = re.search(r'<link rel="icon" href="([^"]+)"', home)
        ogp = urllib.parse.urlsplit(og.group(1)) if og else None
        s4, ct4, img = fetch(SITE + ogp.path + ('?' + ogp.query if ogp.query else '')) if ogp else (0, '', b'')
        s5, ct5, _ = fetch(SITE + ic.group(1).replace('&amp;', '&')) if ic else (0, '', b'')
        ok('④ 공유 미리보기 — og:title · og:image(png) · 아이콘(png)',
           'property="og:title"' in home and s4 == 200 and ct4.startswith('image/png') and img[:4] == b'\x89PNG' and s5 == 200 and ct5.startswith('image/png'),
           f"og {og.group(1) if og else None} → {s4} {ct4} · icon {ic.group(1) if ic else None} → {s5}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
