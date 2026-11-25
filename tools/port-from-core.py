#!/usr/bin/env python3
"""e3.1 (docs/010) 소개뱅크 → ERP 코드 옮기기 — 대표 11/25 「그대로 복사 + 규칙으로 고침」

  python3 tools/port-from-core.py <소개뱅크 작업 트리> <목록 파일> [--check]
    목록 파일 한 줄 = 소개뱅크 기준 경로(예: src/modules/acct/journal.ts) · # 주석
    → api/<같은 경로>(src/modules/acct/journal.ts → api/src/modules/acct/journal.ts) 로 복사하고 아래 규칙만 적용
    → docs/e3-port-<목록 이름>.tsv : 파일 · 줄 · 규칙 · 전 · 후 (바꾼 줄 모두) + 아직 없는 의존(import)

  규칙(이것만 바꿈 · 회계 계산 · 전표 규칙 · 글자는 손대지 않음)
    R1 SQL 의 소개뱅크 표 읽기 FROM · JOIN <표> → svc.<표>   (ERP 표 · ERP 자기 표 · ops_alerts 는 그대로)
    R2 site_settings 읽기 → erp_site_settings (ERP 설정 먼저 · 없으면 소개뱅크 svc.site_settings — E008)
    W  소개뱅크 표 쓰기(INSERT INTO · UPDATE · DELETE FROM) → 바꾸지 않고 목록에 'write'(E3 다음 판에서 내부 API 로)
    I  import 가 ERP 에 없는 파일을 가리키면 목록에 'missing-import'(바꾸지 않음 · 그 판에서 옮기거나 대체)
  --check : 쓰지 않고 지금 파일과 같은지만(같으면 0)
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
CHECK = '--check' in sys.argv
if len(args) < 2:
    print(__doc__); sys.exit(2)
CORE, LIST = args[0], args[1]
ERP_PREFIX = re.compile(r'^(acct|hr|hra|hrx|ofc|qlt|lgl|its|prr|sal|erp)_|^corp_doc')
KEEP = {'ops_alerts'}   # E007 — ERP 안에 같은 이름의 보낼 알림 표

# 소개뱅크 표 목록 = 소개뱅크 마이그레이션의 CREATE TABLE (ERP 표 빼고)
core_tables = set()
mdir = os.path.join(CORE, 'prisma', 'migrations')
for d in sorted(os.listdir(mdir)):
    f = os.path.join(mdir, d, 'migration.sql')
    if os.path.isfile(f):
        for t in re.findall(r'(?i)create table(?: if not exists)?\s+(?:public\.)?"?([a-z_][a-z0-9_]*)', open(f, encoding='utf-8').read()):
            t = t.lower()
            if not ERP_PREFIX.search(t) and t not in KEEP:
                core_tables.add(t)
core_tables.discard('site_settings')   # R2 가 따로

files = [ln.strip() for ln in open(LIST, encoding='utf-8') if ln.strip() and not ln.lstrip().startswith('#')]
report, diff = [], 0
R1 = re.compile(r'(?<![\w.])(FROM|JOIN)(\s+)(?:public\.)?(' + '|'.join(sorted(map(re.escape, core_tables), key=len, reverse=True)) + r')\b(?!\s*\()', re.I)
R2 = re.compile(r'(?<![\w.])(FROM|JOIN)(\s+)(?:public\.)?site_settings\b', re.I)
RW = re.compile(r'\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?([a-z_][a-z0-9_]*)\b', re.I)
IMP = re.compile(r"""from\s+'(\.{1,2}/[^']+)'""")

for rel in files:
    src = os.path.join(CORE, rel)
    if not os.path.isfile(src):
        report.append((rel, '0', 'missing-file', rel, '')); continue
    out_lines = []
    for i, line in enumerate(open(src, encoding='utf-8').read().split('\n'), 1):
        new = line
        # DELETE FROM <소개뱅크 표> 는 쓰기 — R1 이 FROM 을 읽기로 보지 않게 먼저 표시
        for m in RW.finditer(line):
            t = m.group(2).lower()
            if t in core_tables or t == 'site_settings':
                report.append((rel, str(i), 'write', m.group(0), ''))
        masked = RW.sub(lambda m: m.group(0).replace('FROM', 'F\x00ROM').replace('from', 'f\x00rom'), new)
        masked = R1.sub(lambda m: f'{m.group(1)}{m.group(2)}svc.{m.group(3)}', masked)
        masked = R2.sub(lambda m: f'{m.group(1)}{m.group(2)}erp_site_settings', masked)
        new = masked.replace('\x00', '')
        if new != line:
            report.append((rel, str(i), 'R1/R2', line.strip()[:200], new.strip()[:200]))
        for m in IMP.finditer(new):
            target = os.path.normpath(os.path.join(os.path.dirname(rel), m.group(1)))
            erp_t = os.path.join(ROOT, 'api', target)
            if not (os.path.isfile(erp_t + '.ts') or os.path.isfile(os.path.join(erp_t, 'index.ts')) or target + '.ts' in [os.path.normpath(f) for f in files]):
                report.append((rel, str(i), 'missing-import', m.group(1), target))
        out_lines.append(new)
    body = '\n'.join(out_lines)
    head = f'/* e3 (docs/010) 소개뱅크 {rel} 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */\n'
    body = head + body
    dst = os.path.join(ROOT, 'api', rel)
    old = open(dst, encoding='utf-8').read() if os.path.isfile(dst) else None
    if CHECK:
        if old != body:
            diff += 1; print(f'다름  api/{rel}')
        continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(body)

name = os.path.splitext(os.path.basename(LIST))[0]
tsv = 'file\tline\trule\tbefore\tafter\n' + ''.join('\t'.join(x.replace('\t', ' ') for x in r) + '\n' for r in report)
rp = os.path.join(ROOT, 'docs', f'e3-port-{name}.tsv')
if not CHECK:
    with open(rp, 'w', encoding='utf-8') as f:
        f.write(tsv)
kinds = {}
for r in report:
    kinds[r[2]] = kinds.get(r[2], 0) + 1
print(f'== 옮김 {len(files)}파일 · ' + ' · '.join(f'{k} {v}' for k, v in sorted(kinds.items())) + f' · 목록 docs/e3-port-{name}.tsv')
sys.exit(1 if diff else 0)
