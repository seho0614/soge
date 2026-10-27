"""v10.116 시험 — 영어 복수형 · 검색 조건 칩 ㎡(docs/180)

  KIT=… python3 -I test_v1116.py

  ① 개수 문장은 ICU 복수형({n, plural, one {{n} item} other {{n} items}}) — 넘겨받은 글자 그대로 찍음(「1,234」도 그대로) · 모양이 맞음 · 단수 낱말 틀린 것 없음
  ② 검색 조건 칩 — 영어만 ≈㎡(한국어 「30평대」 그대로) · 코드가 m2 를 넘김
  ③ 한국어 사전은 바뀌지 않음 · 옛 사전 시험의 자리표시 비교가 복수형을 받아들임
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


E = {}
for f in ['en.json'] + sorted(os.listdir(os.path.join(M, 'en'))):
    E[f] = flat(json.load(open(os.path.join(M, f if f == 'en.json' else f'en/{f}'), encoding='utf-8')))
PL = [(f, k, v) for f, d in E.items() for k, v in d.items() if 'plural' in v]
SHAPE = re.compile(r'\{(\w+), plural, one \{\{\1\} ([A-Za-z]+)\} other \{\{\1\} ([A-Za-z]+)\}\}')
# v10.134 — 여러 낱말(「{n} unread notification」 · 「{n} required term needs」)도 허용 · 낱말마다 단수 · 복수 짝을 봄
SHAPE2 = re.compile(r'\{(\w+), plural, one \{\{\1\} ([A-Za-z ]+)\} other \{\{\1\} ([A-Za-z ]+)\}\}')
IRREG = {('person', 'people'), ('is', 'are'), ('needs', 'need'), ('contacts', 'contact')}
bad = [(f, k) for f, k, v in PL if not (SHAPE.search(v) or SHAPE2.search(v))]
ok('① 개수 문장 80곳 이상이 복수형 · 모양이 모두 맞음', len(PL) >= 80 and not bad, f'{len(PL)} · 어긋남 {bad[:3]}')
pairs = {(m.group(2), m.group(3)) for _, _, v in PL for m in SHAPE.finditer(v)}
pairs |= {(a, b) for _, _, v in PL for m in SHAPE2.finditer(v) for a, b in zip(m.group(2).split(), m.group(3).split()) if a != b}
pairs -= IRREG
wrong = [p for p in pairs if not (p[1] == p[0] + 's' or p[1] == p[0] + 'es' or (p[0].endswith('y') and p[1] == p[0][:-1] + 'ies'))]
ok('① 단수 · 복수 낱말 짝이 맞음(inquiry · business · reply …)', not wrong, str(wrong))
left = [(f, k, m.group(0)) for f, d in E.items() for k, v in d.items() if 'plural' not in v
        for m in re.finditer(r'\{(n|min|h|days|months)\} ([A-Za-z]+s)\b', v) if m.group(2) not in ('less',)]
ok('① 개수 자리 뒤에 복수 낱말이 그대로 붙은 곳이 남지 않음', not left, str(left[:4]))
S = json.load(open(os.path.join(M, 'en/search.json'), encoding='utf-8'))['prompt']['chip']
SK = json.load(open(os.path.join(M, 'ko/search.json'), encoding='utf-8'))['prompt']['chip']
P = open(os.path.join(K, 'site/src/app/search/PromptSearch.tsx'), encoding='utf-8').read()
ok('② 검색 조건 칩 — 영어만 ≈{m2}㎡ · 한국어는 그대로 · 코드가 m2 를 넘김(1평 = 3.3058㎡)',
   all('{m2}㎡' in S[k] for k in ('sizeAround', 'sizeMax', 'sizeMin')) and all('m2' not in SK[k] for k in ('sizeAround', 'sizeMax', 'sizeMin'))
   and 'Math.round(p * 3.3058)' in P and "m2: m2(r.sizeAround)" in P, f"{S['sizeAround']} · {SK['sizeAround']}")
KO = [json.load(open(os.path.join(M, f'ko/{f}'), encoding='utf-8')) for f in sorted(os.listdir(os.path.join(M, 'ko')))]
ok('③ 한국어 사전에는 복수형이 없음(한국어 화면 그대로)', not any('plural' in json.dumps(d, ensure_ascii=False) for d in KO), '')
T = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_v1102.py'), encoding='utf-8').read()
ok('③ 옛 사전 시험이 복수형을 받아들임(이름 집합 비교 · 칩의 m2 허용)', "re.findall(r'\\{(\\w+)[},]'" in T and "{'m2'} if k.startswith('prompt.chip.size')" in T, '')
ok('VERSION v10.116 이상', tuple(map(int, open(os.path.join(K, 'VERSION')).read().strip().lstrip('v').split('.'))) >= (10, 116), '')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
