"""v10.113 시험 — 영어 문장 고침(대표 「제안대로」 2026-10-26 · docs/177)

  KIT=… python3 -I test_v1113.py

  ① 뜻이 틀렸던 4곳이 고쳐짐 · ② 정한 용어로 통일(옛 말이 남지 않음) · ③ 모든 묶음에서 ko · en 키 · 자리표시 · 태그가 같음 · 영어에 한글 없음
"""
import json, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
M = os.path.join(K, 'site/src/i18n/messages')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def flat(d, p=''):
    r = {}
    for k, v in d.items():
        kk = f'{p}.{k}' if p else k
        r.update(flat(v, kk) if isinstance(v, dict) else {kk: v})
    return r


def load(lang, ns):
    return flat(json.load(open(os.path.join(M, f'{lang}.json' if ns == 'common' else f'{lang}/{ns}.json'), encoding='utf-8')))


E = {ns: load('en', ns) for ns in ['common'] + sorted(f[:-5] for f in os.listdir(os.path.join(M, 'en')) if f.endswith('.json'))}
KO = {ns: load('ko', ns) for ns in E}
ok('① 검색 오류 — 「결과 없음」이 아니라 「검색 실패」', E['search']['prompt.failed'].startswith('Search failed.'), E['search']['prompt.failed'])
ok('① 소개장터 안내 — 공급자를 「모십니다」', 'We welcome suppliers' in E['money']['view.ctaText'], E['money']['view.ctaText'][:60])
ok('① 안심소개 부동산 — 대금 전에 「먼저」 갖춤', 'in place first' in E['gwan']['axes.MAL.realty.s4'], E['gwan']['axes.MAL.realty.s4'][:70])
ok('① 소개창업 인력 — 고용에 관여하지 않는 주체는 소개자', 'we do no' not in E['gwan']['biz.b2b'] and 'referrer' in E['gwan']['biz.b2b'].lower(), E['gwan']['biz.b2b'][-90:])
allen = '\n'.join(v for d in E.values() for v in d.values())
old = {t: len(re.findall(p, allen)) for t, p in (('Get referred', r'Get referred'), ('exposure fee', r'[Ee]xposure fee'), ('HQ', r'\bHQ\b'), ('Sign out', r'Sign out'))}
ok('② 정한 용어 — Get a referral · listing fee · SogaeBank · Log out (옛 말 0)', not any(old.values()), str(old))
ok('② 대표자 → Representative(가입 화면) · 로그아웃 → Log out', any('Representative' in v for v in E['common'].values()) and any(v == 'Log out' for v in E['common'].values()), '')
ph = lambda s: sorted(re.findall(r'\{[^}]+\}', s)) + sorted(re.findall(r'</?[a-zA-Z0-9]+>', s))
keydiff = [(ns, k) for ns in E for k in set(KO[ns]) ^ set(E[ns])]
phdiff = [(ns, k) for ns in E for k in E[ns] if k in KO[ns] and isinstance(KO[ns][k], str) and sorted(re.findall(r'\{(\w+)', KO[ns][k])) != sorted(re.findall(r'\{(\w+)', E[ns][k]))]
tagdiff = [(ns, k) for ns in E for k in E[ns] if len(re.findall(r'<b>', E[ns][k])) != len(re.findall(r'</b>', E[ns][k]))]
ok('③ 모든 묶음 ko · en 키가 같음', not keydiff, str(keydiff[:5]))
ok('③ 자리표시 이름이 ko 와 같음', not phdiff, str(phdiff[:5]))
ok('③ 굵게 태그 짝이 맞음', not tagdiff, str(tagdiff[:5]))
ko_in_en = [(ns, k) for ns in E for k, v in E[ns].items() if re.search('[가-힣]', v)]
ok('③ 영어에 한글 없음(예외 없이)', not ko_in_en, str(ko_in_en[:5]))
ok('VERSION v10.113 이상', tuple(map(int, open(os.path.join(K, 'VERSION')).read().strip().lstrip('v').split('.'))) >= (10, 113), '')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
