"""v10.183 시험 — 소개장터 · 소개몰 디자인 검토 반영(docs/286 · 마이그레이션 없음)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e SITE=http://localhost:15174 sgb-qa:v1 python3 test_v1183.py

  ① 코드 — 카드 모서리 시트 값 · 이름표 낱말 단위 · 아이콘 5 · 휴대폰 배너 덮개 · 대비 고친 색 · 조항 제목 18px · 규칙 번호 12px · 검색 단추 남색 · 그림 글꼴 · 칸 제목 24px · 맺음 30px · docs/286 · 판
  ② (사용자 웹) 소개몰 메인에 새 아이콘 · 이름표가 잘리지 않음 · 소개장터 메인 · 이용안내 200
"""
import os, re, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
SITE = os.environ.get('SITE')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


H26 = rd('site/src/styles/hlt26.css'); SHOP = rd('site/src/styles/shop.css'); SITE_CSS = rd('site/src/styles/site.css')
GW = rd('site/src/styles/proto-gwan.css'); MNY = rd('site/src/styles/money.css')
ART = rd('site/src/components/health/ProductArt.tsx'); ICO = rd('site/src/components/shop/ShopIcon.tsx'); MAIN = rd('site/src/components/shop/ShopMain.tsx')

ok('① 소개몰 — 카드 모서리 --sgb-card-r · 이름표 shortLabel · 아이콘 5(MULTI · MSM · SLEEP · GLUCOSE · FATIGUE) · 메인에서 씀 · 휴대폰 배너 덮개 · 머리 「소개몰」 --sgb-shop · 특가 --sgb-orange · 조항 제목 18px · 맺음 30px',
   '--h-radius: var(--sgb-card-r, 8px)' in H26 and '--h-radius: 10px' not in H26
   and 'export function shortLabel' in ART and 'shortLabel(p.name' in ART and "String(p.mainIngredient?.name ?? p.name ?? '').slice(0, 8)" not in ART
   and all(f'{c}: (' in ICO for c in ('MULTI', 'MSM', 'SLEEP', 'GLUCOSE', 'FATIGUE')) and '<ShopIcon code={g.code} />' in MAIN and '<ShopIcon code={c.code} />' in MAIN
   and '.shop-promo::before' in SHOP and '.shop-hero h1 em { font-style: normal; color: var(--sgb-shop, #16a34a); }' in SHOP
   and '.shop-promo h3 em { font-style: normal; color: var(--sgb-orange, #ffa03e);' in SHOP and '.shop-band .tx b { font-size: var(--sgb-fs-title-1, 30px);' in SHOP
   and '.hlt.hlt-guide .hlt-box h3 { font-size: var(--sgb-fs-title-3, 18px); }' in H26 and 'className="hlt hlt-guide"' in rd('site/src/app/health/guide/page.tsx'), '')

ok('① 소개장터 — 규칙 번호 12px 아래로 안 내려감 · 검색 단추 시트 주요 단추 · 그림 글자 본문 글꼴 · 칸 제목 24px(36.5 · 31.3 없음) · 머리 제목 48px 그대로',
   '.rule-code { font-size: max(var(--sgb-fs-micro, 12px), .78em);' in SITE_CSS and 'background:var(--sgb-btn-bg, #00245a);' in GW.split('.gw-fgo{')[1][:200]
   and '.gw-cvs text{font-size:12px;fill:var(--axis);font-family:var(--sgb-font-body)}' in GW and 'fontSize: 10 }}' not in rd('site/src/app/money/new/page.tsx')
   and '36.5px' not in MNY and '31.3px' not in MNY and MNY.count('font-size: var(--sgb-fs-title-2, 24px)') >= 2 and 'font-size: 48px' in MNY, '')

ok('① 문서 · 판 — docs/286 · v10.183 이상', any(f.startswith('286_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 183), rd('VERSION').strip())


def get(path):
    try:
        with urllib.request.urlopen(SITE + path, timeout=120) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''


if SITE:
    s1, h1 = get('/health')
    s2, h2 = get('/money')
    s3, h3 = get('/health/guide')
    s4, h4 = get('/health/direct')
    cut = re.findall(r'>(도라지 배즙 1|실내 자전거 접)<', h1 + h4)
    ok('② 사용자 웹 — 소개몰 메인에 새 아이콘(shop-ico) · 잘린 이름표 없음 · 소개장터 메인 · 이용안내(hlt-guide) · 직판관 200',
       s1 == 200 and 'shop-ico' in h1 and not cut and s2 == 200 and s3 == 200 and 'hlt-guide' in h3 and s4 == 200,
       f'{s1} {h1.count("shop-ico")} · 잘림 {cut} · {s2} · {s3} · {s4}')
else:
    print('  (SITE 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
