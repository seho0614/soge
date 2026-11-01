"""v10.175 시험 — 빈 글자 요청 400 · 검색 사이트 소유 확인(D164) · 매물 · 상품 대표 주소 · 구조화 정보(docs/270)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1175.py

  ① 코드 — D164(seo.verify_google · seo.verify_naver GLOBAL 빈 값 · 지우는 문장 없음 · 202) · 빈 글자 규칙 · layout verification ·
     JsonLd(< 막기) · 매물 상세 canonical · noindex · 이동 경로 · 상품 상세 canonical · offers 는 주문 받기 켜짐일 때만 · docs/270 · 판
  ② (API) %00 → 400 VALIDATION_ERROR(주소 · 검색어) · 서버 오류로 세지 않음(지켜보기 1시간 칸 그대로) · 공개 설정에 seo.* 빈 값
  ③ (사용자 웹) 소유 확인 값 넣으면 머리에 태그 · 빼면 없음 · 매물 상세 canonical + 이동 경로 · 상품 상세 canonical + 상품 정보(주문 받기 켜짐 → 가격 · 꺼짐 → 없음)
"""
import json, os, re, subprocess, time, urllib.error, urllib.parse, urllib.request

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
M = rd('prisma/migrations/D164_seo_site_verify/migration.sql')
ok('① D164 — seo.verify_google · seo.verify_naver(GLOBAL · 빈 값 · 영숫자 형식) · 지우는 문장 없음 · 202 이상',
   "('seo.verify_google', '', 'GLOBAL'," in M and "('seo.verify_naver', '', 'GLOBAL'," in M and M.count("'^[A-Za-z0-9_-]{0,100}$'") == 2
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 202 and 'D164_seo_site_verify' in mig, f'{len(mig)} · {mig[-1]}')
F = rd('src/common/db-error.filter.ts'); LY = rd('site/src/app/layout.tsx'); JL = rd('site/src/components/common/JsonLd.tsx')
ok('① 서버 · 머리 — 빈 글자 규칙 400 · layout verification(구글 · 네이버 · 빈 값이면 없음) · JsonLd < 막기 · 영어 사전',
   'invalid byte sequence for encoding "UTF8": 0x00' in F and "'형식이 올바르지 않습니다 (0x00).'" in F
   and "st['seo.verify_google'] || undefined" in LY and "'naver-site-verification': vn" in LY
   and ".replace(/</g, '\\\\u003c')" in JL and 'application/ld+json' in JL
   and '"형식이 올바르지 않습니다 ({0}).": "The format is not valid ({0})."' in rd('src/common/i18n/server-text.en.ts'), '')
DP = rd('site/src/app/[gwan]/[id]/page.tsx'); PP = rd('site/src/app/health/p/[code]/page.tsx')
ok('① 상세 — 매물 canonical · 공개 아니면 noindex · 이동 경로 / 상품 canonical · offers 는 mall.order_open on 일 때만 · 별점 · docs/270 · 판',
   "alternates: { canonical: `/${gwan}/${id}` }" in DP and "item.status !== 'PUBLISHED' ? { robots: { index: false, follow: false } }" in DP and 'breadcrumbLd(origin' in DP
   and "alternates: { canonical: `/health/p/${encodeURIComponent(p.code)}` }" in PP and "st['mall.order_open'] === 'on' ? { offers:" in PP and "'@type': 'AggregateRating'" in PP
   and any(f.startswith('270_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 175), rd('VERSION').strip())


# ── ② API ─────────────────────────────────────────────────────────────
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


def page(path):
    try:
        return urllib.request.urlopen(SITE + path, timeout=120).read().decode('utf-8', 'replace')
    except Exception as e:
        return f'__ERR__ {e}'


def lds(html):
    out = []
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S):
        try: out.append(json.loads(m.group(1)))
        except Exception: out.append({'_bad': m.group(1)[:80]})
    return out


if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    h0 = call('GET', '/admin/launch-watch', t=T_).get('serverErrorsHour')
    r1 = call('GET', '/health/products/%00'); r2 = call('GET', '/community/posts/%00'); r3 = call('GET', '/search?q=' + urllib.parse.quote('가방\x00'))
    h1 = call('GET', '/admin/launch-watch', t=T_).get('serverErrorsHour')
    ok('② 빈 글자 — 주소 · 검색어 %00 이 500 아님(400 VALIDATION_ERROR 「0x00」) · 서버 오류 1시간 칸 그대로',
       r1.get('_err') == 400 and r1.get('code') == 'VALIDATION_ERROR' and '0x00' in r1.get('message', '') and r2.get('_err') != 500 and r3.get('_err') != 500
       and h0 is not None and h0 == h1, f"{r1.get('_err')} {r1.get('message')} · {r2.get('_err')} · {r3.get('_err')} · 1시간 {h0} → {h1}")
    pub = call('GET', '/site-settings/public')
    ok('② 공개 설정 — seo.verify_google · seo.verify_naver 있음(빈 값)', 'seo.verify_google' in pub and 'seo.verify_naver' in pub, f"{pub.get('seo.verify_google')!r} · {pub.get('seo.verify_naver')!r}")

    # ── ③ 사용자 웹 ───────────────────────────────────────────────────
    if SITE:
        G, N = 'Tst1175_google-AbC', 'tst1175naver0123'
        psql(f"UPDATE site_settings SET value = '{G}' WHERE key = 'seo.verify_google'"); psql(f"UPDATE site_settings SET value = '{N}' WHERE key = 'seo.verify_naver'")
        try:
            hit = ''
            for _ in range(80):   # 사용자 웹 설정 캐시 5분 — 운영 방식(next start)은 시간이 지나야 새 값
                hit = page('/community')
                if G in hit: break
                time.sleep(5)
        finally:
            psql("UPDATE site_settings SET value = '' WHERE key IN ('seo.verify_google', 'seo.verify_naver')")
        ok('③ 소유 확인 — 값 넣으면 머리에 google-site-verification · naver-site-verification',
           f'<meta name="google-site-verification" content="{G}"' in hit and f'<meta name="naver-site-verification" content="{N}"' in hit,
           f"구글 {G in hit} · 네이버 {N in hit}")
        e = call('GET', '/site/sitemap-entries')
        GP = {'MNY': 'money', 'MAL': 'mall', 'BIZ': 'biz'}
        L = [x for x in e.get('listings') or [] if x['gwan'] in GP]
        lp = f"/{GP[L[0]['gwan']]}/{L[0]['id']}" if L else ''
        lh = page(lp + '?ref=TEST') if lp else ''
        bc = [d for d in lds(lh) if d.get('@type') == 'BreadcrumbList']
        ok('③ 매물 상세 — 꼬리(?ref=) 붙여도 canonical 은 대표 주소 · 이동 경로 3칸(마지막이 이 매물) · noindex 없음',
           lp and re.search(r'<link rel="canonical" href="https?://[^"]+' + re.escape(lp) + '"', lh) and bc and len(bc[0]['itemListElement']) == 3
           and bc[0]['itemListElement'][-1]['item'].endswith(lp) and 'noindex' not in lh, f'{lp} · 이동 경로 {len(bc)}')
        H = e.get('products') or []
        pc = H[0]['code'] if H else ''
        pp = f'/health/p/{urllib.parse.quote(pc)}'
        oldo = psql("SELECT value FROM site_settings WHERE key = 'mall.order_open'") or 'on'
        try:
            psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.order_open'")
            ph_on = page(pp)
            prod_on = [d for d in lds(ph_on) if d.get('@type') == 'Product']
            psql("UPDATE site_settings SET value = 'off' WHERE key = 'mall.order_open'")
            prod_off = []
            for _ in range(80):
                prod_off = [d for d in lds(page(pp)) if d.get('@type') == 'Product']
                if prod_off and 'offers' not in prod_off[0]: break
                time.sleep(5)
        finally:
            psql(f"UPDATE site_settings SET value = '{oldo}' WHERE key = 'mall.order_open'")
        ok('③ 상품 상세 — canonical · 상품 정보(이름 · 코드) · 주문 받기 켜짐 → 가격 KRW · 꺼짐 → 가격 없음',
           pc and re.search(r'<link rel="canonical" href="https?://[^"]+' + re.escape(pp) + '"', ph_on) and prod_on and prod_on[0].get('sku') == pc
           and (prod_on[0].get('offers') or {}).get('priceCurrency') == 'KRW' and prod_off and 'offers' not in prod_off[0],
           f"{pc} · 켜짐 {bool(prod_on and prod_on[0].get('offers'))} · 꺼짐 {bool(prod_off and prod_off[0].get('offers'))}")
else:
    print('  (API · DB 없음 — ②③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
