"""v10.697 (docs/805) 메인 hero · 메인 구역 편집
  ① (코드) page.tsx 배치 읽기(?lp=) · 안내 장 숨김 · 글 · 주소 · 그림 · HomeView 구역 차례 · 블록 · 구역 제목(HTitles) · HeroPromo artUrl
  ③ (API · 화면) HOME 초안(hero 글 · 안내 장 소개광장 숨김 · 핵심 맨 앞 · 오늘의 날씨 숨김 · 맨 위 블록 · 「오늘의 소개뱅크」 제목) → 미리보기 링크로 메인을 열면 그대로 · 공개 판은 처음 배치 그대로 — 끝나면 처음 배치(HOME)
  ④ 문서 805 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

PG, HV, HP, HT, SE = (rd('site/src/app/page.tsx'), rd('site/src/components/home/HomeView.tsx'), rd('site/src/components/home/HeroPromo.tsx'),
                      rd('site/src/components/home/hTitles.ts'), rd('site/src/components/home/Sections.tsx'))
LY = rd('site/src/lib/layout.ts')
ok('① 메인 page.tsx — 배치 읽기(?lp=) · 안내 장 숨김 · 글 · 주소 · 그림 · 구역 차례 · 블록(서버가 그려 넘김)',
   "getLayout('HOME', (await searchParams).lp)" in PG and "so[s.k]?.show !== false" in PG and "artUrl: so[s.k]!.image" in PG and 'layOrder(lay, HOME_SECS)' in PG
   and '<LayBlocks code="MNY" blocks={b} at={at} />' in PG and 'order={order} texts={lay?.texts ?? {}} ins={ins}' in PG, '')
ok('① HomeView — 구역 차례 · 보이기 · 맨 위 · 구역 뒤 블록 · hero 글 · 구역 제목 9 · 관이 꺼지면 안심소개 · 창업 안 나옴',
   '(order ?? HOME_DEFAULT).map(({ key, show })' in HV and '{ins._top}' in HV and '{sec}{ins[key]}' in HV and 'texts.heroTitleA ||' in HV
   and "key === 'trust' ? (on('MAL') ? <Trust c={c} /> : null)" in HV and '<HTitles.Provider value={texts}>' in HV
   and SE.count('const H = useContext(HTitles);') == 9 and SE.count("{H['h.") == 9 and 's.artUrl ?' in HP and 'createContext' in HT, str(SE.count('const H = useContext(HTitles);')))
ok('① 배치 도우미 — 없으면 처음 차례 · 빠진 구역 뒤에 · CSS 는 바꿀 때만 · 미리보기는 캐시 없이',
   'export function layOrder(' in LY and 'export function layCss(' in LY and "if (!lay) return '';" in LY and "?preview=${tok}`, 0)" in LY, '')

if up() and SITE:
    try:
        reset('HOME')
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        call('POST', '/admin/site-layouts/HOME/editable', {'editable': True}, TS)   # v10.701 메인은 수정 가능 스위치만(관 열림 규칙 없음)
        order = ['core', 'forme', 'today', 'needs', 'picks', 'poll', 'strip', 'town', 'trust', 'startup']
        lay = {'sections': [{'key': k, 'show': True} for k in order] + [{'key': 'weather', 'show': False}],
               'texts': {'heroTitleA': '시험 1697 제목', 'heroLeadA': '시험 1697 설명', 'h.today': '시험 1697 오늘'},
               'slides': {'community': {'show': False}, 'health': {'show': True, 'title': '시험 1697 소개몰 장'}},
               'inserts': {'_top': [{'type': 'TEXT', 'title': '시험 1697 블록', 'body': '맨 위 블록'}]}}
        d = call('PATCH', '/admin/site-layouts/HOME', {'layout': lay}, TS)
        ok('③ HOME 초안 저장 — 핵심 맨 앞 · 날씨 숨김 · 글 · 안내 장', (d.get('draft') or {}).get('sections', [{}])[0].get('key') == 'core'
           and (d.get('draft') or {}).get('texts', {}).get('heroTitleA') == '시험 1697 제목' and (d.get('draft') or {}).get('slides', {}).get('community', {}).get('show') is False, str(d.get('code', '')))
        tok = call('POST', '/admin/site-layouts/HOME/previews', {'hours': 1}, TS).get('token', '')
        st, html = page(f'/?lp={tok}')
        i_core, i_today = html.find('id="home-core-h"'), html.find('id="home-today-h"')
        ok('③ 미리보기 메인 — hero 글 · 맨 위 블록 · 핵심이 오늘의 소개뱅크보다 앞 · 바꾼 제목 · 소개몰 장 제목',
           st == 200 and '시험 1697 제목' in html and '시험 1697 설명' in html and 'data-lay-ins="_top"' in html and '시험 1697 블록' in html
           and 0 < i_core < i_today and '시험 1697 오늘' in html and ('시험 1697 소개몰 장' in html or psql("SELECT is_active FROM gwans WHERE code = 'HLT'") != 't'), f'{st} core {i_core} today {i_today}')   # 소개몰 장은 관이 켜졌을 때만
        st2, html2 = page('/')
        ok('③ 공개 메인은 처음 배치 그대로(게시 전)', st2 == 200 and '시험 1697 제목' not in html2 and 'data-lay-ins' not in html2, str(st2))
    finally:
        reset('HOME')
        ok('③ 끝 — HOME 처음 배치', psql("SELECT draft::text || coalesce(published::text, '') FROM site_layouts WHERE key = 'HOME'") == '{}', '')
else:
    print('API · DB · 사용자 웹 없음 — ③ 건너뜀')

d5 = doc('805_')
ok('④ 문서 805 — hero · 안내 장 · 구역 · 제목', all(w in d5 for w in ('hero', '안내 장', '구역', '제목', '처음')), str(len(d5)))
ok('④ VERSION v10.697 이상', VT >= (10, 697), VER)
done()
