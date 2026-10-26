"""v10.114 시험 — 영어 문장 고침 2 · 나머지 화면(대표 「제안대로」 2026-10-26 · docs/178) — v10.113 시험(test_v1113)에 더함

  KIT=… python3 -I test_v1114.py

  ① 뜻이 틀렸던 4곳(나머지 화면) · ② 정한 용어(offer · credit · Help Center · Log in/out · our team · SogaeBank) · ③ 모든 묶음 키 · 자리표시 · 태그 · 한글
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
ok('① 소개광장 — 「노출료 · 소개비 없음」', E['plaza']['best.noFee'].startswith('No listing fee'), E['plaza']['best.noFee'])
ok('① 법률 · 세무 노출 — 수임은 「이긴 사건」이 아님', 'cases won' not in E['join']['directoryApply.lead'], E['join']['directoryApply.lead'][:80])
ok('① 소개받기 목록 안내 — 「남의 회사 사정」', "other companies' business" not in E['request']['list.warn'], E['request']['list.warn'][:80])
ok('① 정책 안내 — 인증이 필요한 「업종」', 'industries' in E['policy']['guide.intro'], E['policy']['guide.intro'][-90:])
ok('① 소개광장 「구인」 문장은 원문 확인 전이라 그대로(hire)', 'hire' in E['plaza']['urgent.addP'], E['plaza']['urgent.addP'])
allen = '\n'.join(v for d in E.values() for v in d.values())
old = {t: len(re.findall(p, allen)) for t, p in (('Get referred', r'Get referred'), ('exposure fee', r'[Ee]xposure fee'), ('HQ', r'\bHQ\b'),
       ('Sign in/out', r'Sign (in|out)'), ('attribution', r'[Aa]ttribution'), ('proposal', r'\b[Pp]roposals?\b'), ('Customer center', r'Customer [Cc]enter|Help center'),
       ('SoGaeBank', r'SoGaeBank'), ('operator', r'(?<!pharmacy )\b[Oo]perators?\b'))}
ok('② 정한 용어 — 옛 말 0(Get referred · exposure fee · HQ · Sign in/out · attribution · proposal · Customer center · operator)', not any(old.values()), str(old))
ok('② 대표자 → Representative(가입 화면) · 로그아웃 → Log out', any('Representative' in v for v in E['common'].values()) and any(v == 'Log out' for v in E['common'].values()), '')
ph = lambda s: sorted(re.findall(r'\{[^}]+\}', s)) + sorted(re.findall(r'</?[a-zA-Z0-9]+>', s))
keydiff = [(ns, k) for ns in E for k in set(KO[ns]) ^ set(E[ns])]
phdiff = [(ns, k) for ns in E for k in E[ns] if k in KO[ns] and isinstance(KO[ns][k], str) and set(re.findall(r'\{(\w+)', KO[ns][k])) != set(re.findall(r'\{(\w+)', E[ns][k])) - ({'m2'} if k.startswith('prompt.chip.size') else set())]
tagdiff = [(ns, k) for ns in E for k in E[ns] if len(re.findall(r'<b>', E[ns][k])) != len(re.findall(r'</b>', E[ns][k]))]
ok('③ 모든 묶음 ko · en 키가 같음', not keydiff, str(keydiff[:5]))
ok('③ 자리표시 이름이 ko 와 같음', not phdiff, str(phdiff[:5]))
ok('③ 굵게 태그 짝이 맞음', not tagdiff, str(tagdiff[:5]))
ko_in_en = [(ns, k) for ns in E for k, v in E[ns].items() if re.search('[가-힣]', v)]
ok('③ 영어에 한글 없음(예외 없이)', not ko_in_en, str(ko_in_en[:5]))
ok('VERSION v10.114 이상', tuple(map(int, open(os.path.join(K, 'VERSION')).read().strip().lstrip('v').split('.'))) >= (10, 114), '')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
