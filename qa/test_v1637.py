"""v10.637 (docs/781) AI 설명서 절 고르기 품질 — 질문 30개 ↔ 기대 절(qa/fixtures/manual_pick_cases.json)
  KIT=<kit> python3 -I test_v1637.py          (서버에서 — 회귀 실행기 HOST 목록 · node 22 --experimental-strip-types · AI 부르지 않음)
  ① (코드) manual-pick.ts 는 다른 모듈을 읽지 않음 · splitManual · manualWords · manualScore(제목 3 · 장 2 · 본문 1) · manualBlock ·
     HelpService.sections · agent-chat 이 이것을 씀 · 문서 781 · 판
  ② (실행 · API 가 있으면 공개 설명서 본문으로) 읽는 양을 fixture max(6000자 · 설명서의 3분의 1 안팎)로 줄였을 때 기대 절이 들어가는 비율 ≥ threshold(0.9)
  (임시 폴더는 스스로 지움 — 읽기만 · 두 번 돌아도 통과)
"""
import json, os, re, shutil, subprocess, sys, tempfile, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API') or ''
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(p):
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd(os.path.join(K, 'VERSION')).strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))
MP = rd(os.path.join(K, 'src/modules/agent/manual-pick.ts'))
AC = rd(os.path.join(K, 'src/modules/agent/agent-chat.service.ts'))
HS = rd(os.path.join(K, 'src/modules/help/help.service.ts'))
FX = json.loads(rd(os.path.join(HERE, 'fixtures', 'manual_pick_cases.json')) or '{}')

# ── ① 코드 ─────────────────────────────────────────────
ok('① manual-pick.ts — import 없음 · splitManual · manualWords · manualScore(제목 3 · 장 2 · 본문 1) · manualBlock(ids)',
   bool(MP) and not re.search(r'^\s*import\s', MP, re.M) and all(f'export function {f}(' in MP for f in ('splitManual', 'manualWords', 'manualScore', 'manualBlock'))
   and 'sec.heading.includes(w)) s += 3' in MP and 'sec.chapter?.includes(w)) s += 2' in MP and 'sec.text.includes(w)) s += 1' in MP and 'ids: chosen.map((x) => x.id)' in MP)
ok('① HelpService.sections = splitManual · agent-chat 이 manual-pick 을 씀(따로 셈 없음)',
   'return splitManual(body);' in HS and "from './manual-pick'" in AC and 'function manualScore' not in AC)
ok('① fixture — 질문 30개 · max · threshold 0.9', len(FX.get('cases', [])) == 30 and FX.get('threshold') == 0.9 and int(FX.get('max', 0)) > 0, str(len(FX.get('cases', []))))
d = os.path.join(K, 'docs')
d781 = next((rd(os.path.join(d, x)) for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith('781_')), '')
ok('① 문서 781 — 30개 · 90% · manual-pick · 장 제목', all(w in d781 for w in ('30개', '90%', 'manual-pick', '장 제목')), str(len(d781)))
ok('① VERSION v10.637 이상', VT >= (10, 637), VER)

# ── ② 실행 ─────────────────────────────────────────────
body = ''
try:
    if API:
        body = json.loads(urllib.request.urlopen(API + '/site/manual', timeout=20).read()).get('body') or ''
except Exception:
    body = ''
if body and MP and shutil.which('node'):
    tmp = tempfile.mkdtemp(prefix='t1637_')
    try:
        open(os.path.join(tmp, 'mp.mts'), 'w', encoding='utf-8').write(MP)
        open(os.path.join(tmp, 'body.txt'), 'w', encoding='utf-8').write(body)
        open(os.path.join(tmp, 'run.mjs'), 'w', encoding='utf-8').write('''import fs from 'node:fs';
const M = await import(process.argv[2]);
const body = fs.readFileSync(process.argv[3], 'utf8');
const fx = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const secs = M.splitManual(body);
const miss = []; let hits = 0;
for (const c of fx.cases) {
  const r = M.manualBlock(1, secs, c.q, fx.max);
  const heads = secs.filter((s) => r.ids.includes(s.id)).map((s) => s.heading);
  if (c.want.some((w) => heads.some((h) => h.startsWith(w)))) hits++; else miss.push(c.q);
}
console.log(JSON.stringify({ secs: secs.length, chars: body.length, hits, total: fx.cases.length, miss }));
''')
        r = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', os.path.join(tmp, 'run.mjs'), os.path.join(tmp, 'mp.mts'),
                            os.path.join(tmp, 'body.txt'), os.path.join(HERE, 'fixtures', 'manual_pick_cases.json')], capture_output=True, text=True, timeout=120)
        out = json.loads(r.stdout or '{}') if r.returncode == 0 else {}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    rate = out.get('hits', 0) / max(1, out.get('total', 1))
    ok(f"② 읽는 양 {FX.get('max')}자로 줄였을 때 기대 절이 들어감 ≥ {FX.get('threshold')}", out and rate >= FX.get('threshold', 0.9),
       f"{out.get('hits')}/{out.get('total')} · 절 {out.get('secs')} · 설명서 {out.get('chars')}자 · 놓침 {out.get('miss', [])[:3]} {r.stderr[-120:] if r.returncode else ''}")
else:
    print('  (API · 설명서 · node 중 없는 것이 있어 ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
