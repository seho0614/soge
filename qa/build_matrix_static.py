"""매트릭스 간이판 — 코드만 읽어서 (개발 DB 없이 · 추가 설치 없이)  v10.43 · 2026-10-15

  python3 build_matrix_static.py <sgb 폴더> <출력.xlsx> [realcheck_*.txt]

  정식판(qa/matrix_pc.ps1 → gen-matrix.js · 개발 DB)을 돌릴 수 없는 곳(개발 서버 sgbdev)에서 씁니다.
  정식판과 다른 점
    - DB 표 · 뷰 · 함수는 **마이그레이션 SQL 파일**에서 뽑습니다(실제 DB 아님 · 행 수 없음 · 동적 SQL 로 만든 것은 빠질 수 있음)
    - 연동은 마이그레이션이 처음 넣은 값입니다(운영에서 바꾼 상태 아님)
    - 백엔드 → 표 연결은 컨트롤러가 든 모듈 폴더의 SQL 에 나오는 표 이름(모듈 단위)입니다
  엑셀은 openpyxl 없이 파이썬 기본 기능(zipfile)으로 씁니다.
"""
import glob, json, os, re, sys, zipfile
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape

K = sys.argv[1]
OUT = sys.argv[2]
RC = sys.argv[3] if len(sys.argv) > 3 else None
rd = lambda p: open(p, encoding='utf-8', errors='replace').read()
rel = lambda p: os.path.relpath(p, K)
KST = timezone(timedelta(hours=9))
VER = rd(os.path.join(K, 'VERSION')).strip()
norm = lambda p: re.sub(r'\$\{[^}]*\}|:[A-Za-z_]+|\{[^}]*\}', '{}', re.sub(r'[?#].*$', '', p)).rstrip('/') or '/'

# ── 1. 화면(등록) ───────────────────────────────────────────────────
S = json.load(open(os.path.join(K, 'spec/screens.json'), encoding='utf-8'))
screens = S['screens']
proto = rd(os.path.join(K, 'spec/proto.html')) if os.path.exists(os.path.join(K, 'spec/proto.html')) else ''

# ── 2. 페이지 ───────────────────────────────────────────────────────
CALL = re.compile(r"\b(?:api|apiGet|apiPost|apiPut|apiPatch|apiDelete|get|post|put|patch|del|request|fetch)\w*(?:<[^>(]*>)?\(\s*[`'\"]((?:/api/v1)?/[a-z][^`'\"]*)")
def calls_of(src):
    out = set()
    for p in CALL.findall(src):
        p = re.sub(r'^/api/v1', '', p)
        out.add(norm(p))
    return sorted(out)

pages = []
for f in sorted(glob.glob(os.path.join(K, 'site/src/app/**/page.tsx'), recursive=True)):
    route = '/' + os.path.relpath(os.path.dirname(f), os.path.join(K, 'site/src/app')).replace(os.sep, '/')
    route = re.sub(r'/\([^)]*\)', '', route.replace('/.', '')) or '/'
    d = os.path.dirname(f); src = ''.join(rd(x) for x in glob.glob(os.path.join(d, '*.tsx')))
    pages.append(['사용자 웹', route if route != '/.' else '/', rel(f), ' | '.join(sorted(set(re.findall(r'SB-[A-Z]+-[A-Z0-9]+-\d+', src)))), calls_of(src)])
for f in sorted(glob.glob(os.path.join(K, 'web/src/app/**/*.tsx'), recursive=True)):
    src = rd(f)
    pages.append(['운영 화면', '', rel(f), ' | '.join(sorted(set(re.findall(r'SB-[A-Z]+-[A-Z0-9]+-\d+', src)))), calls_of(src)])

callers = {}
for app, _, f, _, cs in pages:
    for c in cs: callers.setdefault(c, set()).add(f)
for f in glob.glob(os.path.join(K, 'site/src/**/*.ts*'), recursive=True) + glob.glob(os.path.join(K, 'web/src/**/*.ts*'), recursive=True):
    for c in calls_of(rd(f)): callers.setdefault(c, set()).add(rel(f))

# ── 3. DB (마이그레이션 SQL) ────────────────────────────────────────
migs = sorted(glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
rels, fns, integ = {}, {}, {}
for f in migs:
    m = os.path.basename(os.path.dirname(f)); s = rd(f)
    for kind, name in re.findall(r'CREATE\s+(?:UNLOGGED\s+)?(TABLE|VIEW|MATERIALIZED VIEW)\s+(?:IF NOT EXISTS\s+)?([\w.]+)', s, re.I):
        n = name if '.' in name else 'public.' + name
        rels.setdefault(n, {'kind': kind.upper(), 'first': m})['last'] = m
    for name in re.findall(r'CREATE\s+OR\s+REPLACE\s+VIEW\s+([\w.]+)', s, re.I):
        n = name if '.' in name else 'public.' + name
        rels.setdefault(n, {'kind': 'VIEW', 'first': m})['last'] = m
    for name in re.findall(r'DROP\s+(?:TABLE|VIEW|MATERIALIZED VIEW)\s+(?:IF EXISTS\s+)?([\w.]+)', s, re.I):
        n = name if '.' in name else 'public.' + name
        if n in rels: rels[n]['dropped'] = m
    for name in re.findall(r'CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w.]+)\s*\(', s, re.I):
        n = name if '.' in name else 'public.' + name
        fns.setdefault(n, {'first': m})['last'] = m
    for name in re.findall(r'DROP\s+(?:FUNCTION|PROCEDURE)\s+(?:IF EXISTS\s+)?([\w.]+)', s, re.I):
        n = name if '.' in name else 'public.' + name
        if n in fns: fns[n]['dropped'] = m
    for row in re.findall(r"INSERT INTO public\.integrations \([^)]*\)\s*VALUES\s*\('([A-Z_]+)',\s*'([^']*)',\s*'([^']*)',\s*(?:NULL|'[^']*'),\s*'([A-Z_]+)'", s):
        integ[row[0]] = [row[0], row[1], row[2], row[3], m]
    for code, st in re.findall(r"UPDATE public\.integrations SET status\s*=\s*'([A-Z_]+)'[^;]*WHERE code\s*=\s*'([A-Z_]+)'", s):
        if st in integ: integ[st][3] = code
# 뒤에 다시 만든 것은 살아 있는 것으로
for d in list(rels.values()) + list(fns.values()):
    if d.get('dropped') and d['last'] > d['dropped']: d.pop('dropped')

# ── 4. 백엔드 · API ─────────────────────────────────────────────────
DEC = re.compile(r'@(Get|Post|Put|Patch|Delete)\(\s*(?:[\'"`]([^\'"`]*)[\'"`])?\s*\)')
api_rows, back_rows = [], []
for f in sorted(glob.glob(os.path.join(K, 'src/**/*.controller.ts'), recursive=True)):
    s = rd(f); mod = os.path.basename(os.path.dirname(f))
    modsql = ''.join(rd(x) for x in glob.glob(os.path.join(os.path.dirname(f), '*.ts')))
    mtables = sorted({n for n in rels if re.search(r'\b' + re.escape(n.split('.')[1]) + r'\b', modsql)})
    blocks = re.split(r'(?=@Controller\()', s)
    for b in blocks[1:]:
        pm = re.match(r"@Controller\(\s*['\"`]?([^'\"`)]*)", b); prefix = pm.group(1) if pm else ''
        head = b[:b.find('class ')] if 'class ' in b else ''
        croles = re.findall(r"@Roles\(([^)]*)\)", head)
        cname = (re.search(r'class\s+(\w+)', b) or [None, ''])[1]
        body = b[b.find('class '):] if 'class ' in b else b
        for mm in DEC.finditer(body):
            after = body[mm.end():mm.end() + 600]
            hn = re.search(r'\n\s*(?:async\s+)?(\w+)\s*\(', after)
            before = body[max(0, mm.start() - 400):mm.start()]
            seg = re.split(r'\n\s*\n|\}\s*\n', before)[-1] + after[:hn.start() if hn else 0]
            mroles = re.findall(r"@Roles\(([^)]*)\)", seg) or croles
            decos = sorted(set(re.findall(r'@(\w+)\(', seg)) - {'Get', 'Post', 'Put', 'Patch', 'Delete', 'Roles', 'ApiOperation', 'ApiResponse', 'ApiTags', 'ApiBearerAuth', 'Body', 'Param', 'Query', 'Req', 'Res', 'HttpCode', 'ApiQuery', 'ApiParam', 'ApiBody', 'ApiProperty', 'ApiPropertyOptional', 'Header', 'Headers', 'IsOptional', 'IsString', 'IsIn'})
            path = '/' + '/'.join(x.strip('/') for x in (prefix, mm.group(2) or '') if x.strip('/'))
            path = re.sub(r'^/api/v1', '', path) or '/'
            roles = ', '.join(r.replace("'", '').replace('"', '').strip() for r in mroles) or '(없음 · 공개 또는 전역 가드)'
            key = norm(path)
            who = sorted(callers.get(key, []))
            api_rows.append([mm.group(1).upper(), path, mod, cname, roles, ' | '.join(decos), '부르는 곳 있음' if who else '부르는 곳 못 찾음', who[:12], mtables[:30]])
            back_rows.append([mod, cname, hn.group(1) if hn else '', mm.group(1).upper(), path, roles, ' | '.join(decos), rel(f)])

# 화면 → API 대조
known = {(a[0], norm(a[1])) for a in api_rows}
scr_rows = []
for x in screens:
    miss = [a for a in x.get('apis', []) if (a.split(' ', 1)[0], norm(a.split(' ', 1)[1] if ' ' in a else '')) not in known]
    impl = [p[2] for p in pages if x['id'] in p[3].split(' | ')]
    scr_rows.append([x['id'], x.get('name', ''), x.get('group', ''), x.get('url', ''), ', '.join(x.get('roles', [])), ', '.join(x.get('gates', [])),
                     impl[:6], '있음' if x['id'] in proto else '없음', len(x.get('apis', [])), ' | '.join(miss) if miss else '모두 있음'])

# ── 5. realcheck ────────────────────────────────────────────────────
rc_rows = []
if RC and os.path.exists(RC):
    for l in rd(RC).splitlines():
        t = l.strip()
        if t.startswith(('통과  ', '실패  ')): rc_rows.append([t[:2], t[2:].strip()])
        elif t.startswith(('통과 ', '안전 ', 'SQL 대조', '진짜 이미지 확인', '통합 검정')): rc_rows.append(['요약', t])

live_rels = {k: v for k, v in rels.items() if not v.get('dropped')}
live_fns = {k: v for k, v in fns.items() if not v.get('dropped')}
miss_scr = sum(1 for r in scr_rows if r[-1] != '모두 있음')
nocall = sum(1 for r in api_rows if r[6] != '부르는 곳 있음')
summary = [
    ['판', VER], ['종류', '간이판 — 코드 · 마이그레이션 파일만 읽음(개발 DB 없음) · 정식판은 qa/matrix_pc.ps1'],
    ['만든 때(KST)', datetime.now(KST).strftime('%Y-%m-%d %H:%M')],
    ['마이그레이션 파일', len(migs)],
    ['화면(등록) · 구현 페이지 있음 · 시안 있음', f"{len(screens)} · {sum(1 for r in scr_rows if r[6])} · {sum(1 for r in scr_rows if r[7] == '있음')}"],
    ['페이지 사용자 웹 · 운영 화면', f"{sum(1 for p in pages if p[0] == '사용자 웹')} · {sum(1 for p in pages if p[0] == '운영 화면')}"],
    ['API(컨트롤러 핸들러)', len(api_rows)],
    ['DB 표 · 뷰 · 함수 (마이그레이션 기준)', f"{sum(1 for v in live_rels.values() if v['kind'] == 'TABLE')} · {sum(1 for v in live_rels.values() if v['kind'] != 'TABLE')} · {len(live_fns)}"],
    ['외부 연동(처음 넣은 값)', len(integ)],
    ['점검 — 등록 화면의 API 가 백엔드에 없음', miss_scr],
    ['점검 — 화면 코드에서 부르는 곳을 못 찾은 API(정적 탐색 한계 포함)', nocall],
    ['realcheck', os.path.basename(RC) if RC else '없음'],
    ['realcheck 결과', next((r[1] for r in rc_rows if r[1].startswith('진짜 이미지 확인')), '없음')],
]

# ── 6. xlsx (inline string) ─────────────────────────────────────────
SHEETS = [
    ('요약', ['항목', '값'], summary),
    ('화면', ['id', '이름', '묶음', '주소', '역할', '게이트', '구현 파일', '시안', '등록 API 수', '백엔드에 없는 API'], scr_rows),
    ('페이지', ['앱', '경로', '파일', '화면 id', '부르는 API'], pages),
    ('백엔드', ['모듈', '컨트롤러', '핸들러', '방식', '경로', '역할', '그 밖의 데코레이터', '파일'], back_rows),
    ('API', ['방식', '경로', '모듈', '컨트롤러', '역할', '그 밖의 데코레이터', '화면 연결', '부르는 파일', '모듈 SQL 의 표'], api_rows),
    ('DB', ['이름', '종류', '처음 만든 마이그레이션', '마지막으로 바꾼 마이그레이션'], [[k, v['kind'], v['first'], v['last']] for k, v in sorted(live_rels.items())]),
    ('DB 함수', ['이름', '처음 만든 마이그레이션', '마지막으로 바꾼 마이그레이션'], [[k, v['first'], v['last']] for k, v in sorted(live_fns.items())]),
    ('연동', ['code', '이름', '용도', '상태(처음 값)', '넣은 마이그레이션'], list(integ.values())),
    ('realcheck', ['결과', '내용'], rc_rows),
]
BAD = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')
def cval(v):
    if isinstance(v, (list, tuple, set)): v = ' | '.join(map(str, v))
    v = '' if v is None else v
    if isinstance(v, (int, float)) and not isinstance(v, bool): return f'<v>{v}</v>', 'n'
    v = BAD.sub('', str(v))[:3000]
    return f'<is><t xml:space="preserve">{escape(v)}</t></is>', 'inlineStr'
def col(i):
    s = ''
    while i >= 0: s = chr(65 + i % 26) + s; i = i // 26 - 1
    return s
def sheet_xml(heads, rows):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
           '<cols>' + ''.join(f'<col min="{i+1}" max="{i+1}" width="{min(60, max(12, len(h) * 2 + 4))}" customWidth="1"/>' for i, h in enumerate(heads)) + '</cols><sheetData>']
    for r, row in enumerate([heads] + rows):
        cells = []
        for c, v in enumerate(row):
            x, t = cval(v)
            st = ' s="1"' if r == 0 else ' s="2"'
            cells.append(f'<c r="{col(c)}{r+1}" t="{t}"{st}>{x}</c>' if t == 'inlineStr' else f'<c r="{col(c)}{r+1}"{st}>{x}</c>')
        out.append(f'<row r="{r+1}">' + ''.join(cells) + '</row>')
    out.append('</sheetData>')
    if rows: out.append(f'<autoFilter ref="A1:{col(len(heads)-1)}{len(rows)+1}"/>')
    out.append('</worksheet>')
    return ''.join(out)
STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
          '<fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts>'
          '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/></patternFill></fill></fills>'
          '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
          '<cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="center"/></xf><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>'
          '</styleSheet>')
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    n = len(SHEETS)
    z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
               '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
               '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
               + ''.join(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(n)) + '</Types>')
    z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    z.writestr('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
               + ''.join(f'<sheet name="{escape(t)}" sheetId="{i+1}" r:id="rId{i+1}"/>' for i, (t, _, _) in enumerate(SHEETS)) + '</sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               + ''.join(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i+1}.xml"/>' for i in range(n))
               + f'<Relationship Id="rId{n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    z.writestr('xl/styles.xml', STYLES)
    for i, (_, h, rows) in enumerate(SHEETS):
        z.writestr(f'xl/worksheets/sheet{i+1}.xml', sheet_xml(h, rows))

print(f'만듦 {OUT}')
for k, v in summary: print(f'  {k}: {v}')
