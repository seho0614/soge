"""v10.63 시험 — 디자인 통일 5단계 ① 읽기 어려운 글자색(docs/119)

  KIT=… python3 -I test_v1063.py

  ① 시트 — 흐린 글자 #646f8c(흰 · 화면 바탕 · 회색 칸 4.5 이상) · 상태 색 글자 3개(4.5 이상) · 상태 바탕 · 점 색(--or · --gr · --rd) 그대로
  ② 사용자 웹 CSS 전수 — 고침 스크립트를 다시 돌려도 바꿀 곳 0 · 못 고친 곳 0 (글자색이 그 규칙 바탕 위에서 4.5 이상)
  ③ 시안 <style> 전수 — 바꿀 곳 0 · 남은 곳은 어두운 바탕 위 밝은 글자 2곳(#toast b · .mh-hand — 바탕이 다른 규칙에 있음)만
"""
import os, re, runpy

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


import sys
sys.argv = ['x', K]
A = runpy.run_path(os.path.join(HERE, 'apply_text_v1063.py'), run_name='test')   # 함수만 불러옴(고치지 않음)
A['V'].update(A['load_vars']())
cr, res = A['cr'], A['res']
T = rd('site/src/styles/sgb-tokens.css')
ink3 = res('var(--sgb-ink-3)')
ok('흐린 글자 #646f8c — 흰 · 화면 바탕 · 회색 칸 4.5 이상', ink3 == '#646f8c' and min(cr(ink3, b) for b in ('#ffffff', '#f5f7fa', '#f2f3f4')) >= 4.5,
   ' · '.join(f'{cr(ink3, b):.2f}' for b in ('#ffffff', '#f5f7fa', '#f2f3f4')))
st = [(n, res(f'var(--sgb-{n}-text)')) for n in ('or', 'gr', 'rd')]
ok('상태 색 글자 3개 — 흰 바탕 4.5 이상', all(h and cr(h, '#ffffff') >= 4.5 for _, h in st), ' · '.join(f'{n} {h} {cr(h, "#ffffff"):.2f}' for n, h in st if h))
TK = rd('site/src/styles/tokens.css')
ok('상태 바탕 · 점 색 그대로(--or #F97316 · --gr · --rd)', '--or:   #F97316;' in TK and re.search(r'--gr:\s*#10B981', TK) and re.search(r'--rd:\s*#EF4444', TK), '')

ST = os.path.join(K, 'site/src/styles')
changed, files = 0, 0
for f in sorted(os.listdir(ST)):
    if not f.endswith('.css') or f in A['SKIP'] or f == 'tokens.css': continue
    s = open(os.path.join(ST, f), encoding='utf-8').read(); files += 1
    if A['keep_comments'](s, f) != s: changed += 1
left = list(A['LEFT'])
ok(f'사용자 웹 CSS {files}개 — 글자색 전부 그 규칙 바탕 위 4.5 이상(다시 돌려도 바꿀 곳 0)', changed == 0 and not left, f'바꿀 파일 {changed} · 못 고친 곳 {left[:3]}')
A['LEFT'].clear()
PR = rd('spec/proto.html')
pc = 0
for m in re.finditer(r'<style(?! id="sgb-btn-style")[^>]*>(.*?)</style>', PR, flags=re.S):
    if A['keep_comments'](m.group(1), 'proto') != m.group(1): pc += 1
pl = [x for x in A['LEFT'] if not re.search(r'#toast b|\.mh-hand', x)]
ok('시안 <style> — 바꿀 곳 0 · 남은 곳은 어두운 바탕 2곳만', pc == 0 and not pl, f'{pc} {pl[:3]}')
ok('VERSION v10.63 이상', re.match(r'v10\.(6[3-9]|[7-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
