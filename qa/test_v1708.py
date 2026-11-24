"""v10.708 (docs/816) 꾸밀 페이지 언어별 글자 — 한국어는 texts · 다른 언어는 i18n[언어](비우면 그 언어 사전 글) · AI 번역 초안
  ① (코드) 서버 i18n(8개 언어 · 열쇠 = 글자 + 안내 장 글 · 길이) · translate(AI · MOCK) · 사용자 웹 forLocale · 운영 화면 언어 단추 · AI 번역 초안
  ③ (API · 화면) HOME 수정 가능 → 한국어 · 영어 글 초안 · 이상한 언어 코드 버림 · ko 번역 422 · 미리보기 — 한국어 화면은 한국어 글 · 영어 화면(sgb_lang=en)은 영어 글 — 끝나면 처음(늘 혼자 · 전체 설정 i18n.enabled 되돌림)
  ④ 문서 816 · 판
"""
import os, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, LY, SP = rd('src/modules/site/site-layouts.service.ts'), rd('site/src/lib/layout.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 — 언어별 글자(ko 빼고 두 글자 · 8개까지 · 글자 + 안내 장 글 · 길이 검사) · AI 번역 초안(TRANSLATE · MOCK · 초안에 씀)',
   'export function i18nKeys(' in SV and "if (Object.keys(i18n).length > 8) bad(" in SV and "lang === 'ko' || !m" in SV and 'async translate(key: string, lang: string)' in SV
   and "this.agent.allowed('TRANSLATE')" in SV and "prov.name === 'MOCK'" in SV and "`${lang} 번역 초안(AI)`" in SV, '')
ok('① 사용자 웹 · 운영 화면 — forLocale(한국어 texts · 다른 언어 i18n · 안내 장 글) · 언어 단추 · AI 번역 초안 · 자리 표시는 한국어 글',
   'export function forLocale(' in LY and "if (!locale || locale === 'ko') return lay;" in LY and 'slide.${k}.title' in LY and 'data-site-layout-langs' in SP and 'data-site-layout-translate' in SP, '')


def page_lang(path, lang):
    try:
        r = urllib.request.urlopen(urllib.request.Request(SITE + path, headers={'User-Agent': 'sgb-qa', 'Cookie': f'sgb_lang={lang}'}), timeout=120)
        return r.status, r.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, str(e)


if up():
    was = psql("SELECT value FROM site_settings WHERE key = 'i18n.enabled'"); en_was = psql("SELECT is_active FROM i18n_langs WHERE code = 'en'")
    try:
        reset('HOME')
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        call('POST', '/admin/site-layouts/HOME/editable', {'editable': True}, TS)
        d = call('PATCH', '/admin/site-layouts/HOME', {'layout': {'texts': {'heroTitleA': '시험 1708 한국어'}, 'i18n': {'en': {'heroTitleA': 'Test 1708 English', 'slide.pf.title': 'Test 1708 slide'}, 'kor': {'heroTitleA': 'x'}, 'ko': {'heroTitleA': 'x'}}}}, TS)
        i18n = (d.get('draft') or {}).get('i18n', {})
        tr = call('POST', '/admin/site-layouts/HOME/translate', {'lang': 'ko'}, TS)
        ok('③ 초안 — 영어 글 · 안내 장 영어 글 · 이상한 코드 · ko 는 버림 · ko 번역 422', i18n == {'en': {'heroTitleA': 'Test 1708 English', 'slide.pf.title': 'Test 1708 slide'}}
           and tr.get('_err') in (400, 422), f"{i18n} {tr.get('_err')} {tr.get('code')}")
        if SITE:
            psql("UPDATE site_settings SET value = 'on' WHERE key = 'i18n.enabled'; UPDATE i18n_langs SET is_active = true WHERE code = 'en';")
            tok = call('POST', '/admin/site-layouts/HOME/previews', {'hours': 1}, TS).get('token', '')
            end_ = time.time() + 75   # 사용자 웹은 다국어 켜짐(i18n.enabled · 언어 목록)을 잠시 캐시 — 켠 값이 보일 때까지 5초마다 다시 읽음
            while True:
                s1, h1 = page_lang(f'/?lp={tok}', 'ko')
                s2, h2 = page_lang(f'/?lp={tok}', 'en')
                if ('Test 1708 English' in h2 and '시험 1708 한국어' in h1) or time.time() > end_:
                    break
                time.sleep(5)
            ok('③ 미리보기 — 한국어 화면은 한국어 글 · 영어 화면은 영어 글(한국어 글 안 나옴)', s1 == 200 and '시험 1708 한국어' in h1 and 'Test 1708 English' not in h1
               and s2 == 200 and 'Test 1708 English' in h2 and '시험 1708 한국어' not in h2, f'{s1} {s2}')
    finally:
        reset('HOME')
        psql(f"UPDATE site_settings SET value = {('NULL' if was == '' else repr(was).replace(chr(34), chr(39)))} WHERE key = 'i18n.enabled'; UPDATE i18n_langs SET is_active = {'true' if en_was == 't' else 'false'} WHERE code = 'en';")
        ok('③ 끝 — HOME 처음 · i18n.enabled · en 되돌림', psql("SELECT value FROM site_settings WHERE key = 'i18n.enabled'") == was and psql("SELECT is_active FROM i18n_langs WHERE code = 'en'") == en_was, '')
else:
    print('API · DB 없음 — ③ 건너뜀')

d = doc('816_')
ok('④ 문서 816 — 언어별 · 사전 글 · AI 번역 초안', all(w in d for w in ('언어별', '사전 글', 'AI 번역 초안')), str(len(d)))
ok('④ VERSION v10.708 이상', VT >= (10, 708), VER)
done()
