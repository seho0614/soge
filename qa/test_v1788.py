"""v10.788 (docs/897) 소개리드 영어 이름 「Leeds」(대표 11/25)
  ① 사용자 웹 영어 머리줄 LED · /lead 영어 제목 = Leeds · 한국어 사전은 그대로(소개리드)
  ② 서버 영어 문장에 옛 이름(Consult Leads) 없음 · Leeds 3줄 · 운영 화면 리드 현황 글자
  ③ 사용자 웹 · 서버 · 운영 화면 코드에 옛 이름 남지 않음(문서 · 주석 기록 빼고) · 문서 897 · 판
  (파일만 읽음 — 두 번 돌아도 통과)
"""
import json, os, re, sys

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
EN = json.loads(rd('site/src/i18n/messages/en.json') or '{}')
KO = json.loads(rd('site/src/i18n/messages/ko.json') or '{}')
CEN = json.loads(rd('site/src/i18n/messages/en/consult.json') or '{}')
STX = rd('src/common/i18n/server-text.en.ts')
LS = rd('web/src/app/admin/partners/LeadStatus.tsx')
led_ko = KO.get('header', {}).get('gwan', {}).get('LED')
ok('① 영어 머리줄 LED · /lead 영어 제목 = Leeds · 한국어 사전은 그대로',
   EN.get('header', {}).get('gwan', {}).get('LED') == 'Leeds' and CEN.get('lead', {}).get('title') == 'Leeds' and (led_ko is None or 'Leeds' not in led_ko),
   f"{EN.get('header', {}).get('gwan', {}).get('LED')} · {CEN.get('lead', {}).get('title')} · ko {led_ko}")
ok('② 서버 영어 문장 — Consult Leads 없음 · Leeds 3곳 이상 · 운영 화면 「리드관(소개리드 · Leeds)」',
   'Consult Leads' not in STX and STX.count('Leeds') >= 3 and '리드관(소개리드 · Leeds)' in LS, str(STX.count('Leeds')))
left = []
for base in ('site/src', 'src', 'web/src'):
    for root, _, files in os.walk(os.path.join(K, base)):
        for f in files:
            if f.endswith(('.ts', '.tsx', '.json')):
                t = open(os.path.join(root, f), encoding='utf-8', errors='ignore').read()
                for ln in t.splitlines():
                    if 'Consult Leads' in ln and 'v10.788' not in ln:
                        left.append(os.path.relpath(os.path.join(root, f), K))
d = os.path.join(K, 'docs')
d897 = next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('897_')), '')
ok('③ 코드에 옛 이름 없음(바꿈 기록 주석 빼고)', not left, str(left[:5]))
ok('③ 문서 897 · 판 v10.788', 'Leeds' in d897 and '소개리드' in d897 and VT >= (10, 788), VER)

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
