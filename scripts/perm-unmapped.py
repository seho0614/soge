#!/usr/bin/env python3
"""v10.564 (D291 · docs/706) — /admin 주소 중 perm_route_map 에 없는 것 뽑기(정적 · 소스 기준)
  쓰는 법: python3 -I perm_unmapped.py <sgb 소스 뿌리> [더 볼 src 폴더 ...] [--sql 출력.sql]
  ① src 의 @Controller · @Get/@Post/... · @Roles 를 읽어 운영 역할만 요구하는 /api/v1/admin 주소를 모음(SUPER 만 · 회원 역할 섞임은 뺌)
  ② prisma/migrations/*/migration.sql 의 perm_route_map INSERT 줄(method, pattern)을 모음
  ③ 빠진 주소에 업무(task)를 붙임 — spec/screens.json 의 화면 apis → 그 화면 bo(#/탭) / 같은 앞머리로 이미 붙은 주소의 업무 / 컨트롤러 이름표
  수준: GET = VIEW · export/csv = EXPORT · approve|fix|finalize|paid|send|confirm|decide = APPROVE · 그 밖 = EDIT(gen_seed.py 와 같은 규칙)
  운영 서버 실제 주소는 GET /admin/perm/unmapped-routes(같은 규칙 · 실행 중 데코레이터)로 확인.
"""
import json, os, re, sys

OPS = {'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'}
DEC = re.compile(r"@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)")


def scan(srcdirs):
    out = []
    for sd in srcdirs:
        for root, _, files in os.walk(sd):
            for f in files:
                if not f.endswith('.ts'):
                    continue
                t = open(os.path.join(root, f), encoding='utf-8').read()
                consts = {k: re.findall(r"'([A-Z_]+)'", v) for k, v in re.findall(r"const (\w+)\s*(?::[^=]+)?=\s*\[([^\]]*)\]", t)}
                if 'OPS_ROLES' in t and 'OPS_ROLES' not in consts:
                    consts['OPS_ROLES'] = sorted(OPS)

                def roles_of(arg):
                    rs = re.findall(r"'([A-Z_]+)'", arg)
                    for sp in re.findall(r"\.\.\.(\w+)", arg):
                        rs += consts.get(sp, ['__SPREAD__'])
                    return rs
                for m in re.finditer(r"@Controller\('([^']*)'\)", t):
                    base = m.group(1)
                    # 컨트롤러 앞 데코레이터 묶음에서 @Roles · 뒤 class 본문
                    head = t[max(0, m.start() - 600):m.start()]
                    tail_start = m.end()
                    nxt = t.find('@Controller(', tail_start)
                    body = t[tail_start: nxt if nxt > 0 else len(t)]
                    cm = re.search(r"export class (\w+)", body)
                    cname = cm.group(1) if cm else f
                    pre = t[m.end(): m.end() + 400]
                    crole = re.findall(r"@Roles\(([^)]*)\)", head.split('export class')[-1] + pre.split('export class')[0])
                    cls_roles = roles_of(crole[-1]) if crole else []
                    for d in DEC.finditer(body):
                        meth, p = d.group(1).upper(), d.group(2) or ''
                        win = body[d.start(): d.start() + 900]
                        stop = re.search(r"\n\s*(?:async\s+)?\w+\([^)]*\)[^{;]*\{", win)
                        seg = win[: stop.start()] if stop else win
                        segb = body[max(0, d.start() - 500): d.start()]
                        segb = segb[segb.rfind('}') + 1:]
                        rr = re.findall(r"@Roles\(([^)]*)\)", segb + seg)
                        if rr:
                            roles = roles_of(rr[-1])
                        else:
                            roles = cls_roles
                        path = '/' + '/'.join(x.strip('/') for x in (base, p) if x.strip('/'))
                        if not path.startswith('/api/v1/admin/') and path != '/api/v1/admin':
                            continue
                        out.append({'method': meth, 'path': path[len('/api/v1'):], 'roles': roles, 'ctl': cname, 'file': os.path.relpath(os.path.join(root, f), sd)})
    return out


# 앞머리 → 업무(화면 목록 · 같은 앞머리로 못 정한 것 · 사람이 정함 · 위에서부터)
OVERRIDE = [
    (r'^/admin/me/hrx', 'hrx-booking'), (r'^/admin/me/hr', 'my-hr'), (r'^/admin/me/notify', 'ofc-notify'), (r'^/admin/me/password', 'my-password'), (r'^/admin/me', 'my-mfa'),
    (r'^/admin/its/my-surveys', 'its-survey'), (r'^/admin/its/suggestions', 'its-suggest'),
    (r'^/admin/accounts/\{[^}]+\}/settlement-summary', 'members'), (r'^/admin/accounts', 'members'),
    (r'^/admin/staff', 'staff-list'), (r'^/admin/perm/me', 'home'), (r'^/admin/perm', 'perm-admin'),
    (r'^/admin/affiliates', 'affiliates'), (r'^/admin/audit', 'gov-audit'), (r'^/admin/export-requests', 'gov-audit'),
    (r'^/admin/brokers', 'quals'), (r'^/admin/qualifications', 'quals'), (r'^/admin/classify', 'ai-ops'), (r'^/admin/segments', 'ai-ops'),
    (r'^/admin/directory', 'directory'), (r'^/admin/etax', 'acct-tax'), (r'^/admin/health', 'hlt-products'),
    (r'^/admin/lead', 'partners'), (r'^/admin/partner-axes', 'partner-axes'), (r'^/admin/partner-center', 'partners'), (r'^/admin/partners', 'partners'),
    (r'^/admin/listings', 'queue'), (r'^/admin/reviews', 'queue'), (r'^/admin/review-reasons', 'queue'), (r'^/admin/risk', 'risk'), (r'^/admin/search', 'mainops'),
]


def pattern(p):
    return re.sub(r':(\w+)', r'{\1}', p).replace('{key}', '{key}')


def mapped(mig):
    s = set()
    rows = []
    for d in sorted(os.listdir(mig)):
        fp = os.path.join(mig, d, 'migration.sql')
        if not os.path.exists(fp):
            continue
        t = open(fp, encoding='utf-8').read()
        for m in re.finditer(r"\('(GET|POST|PUT|PATCH|DELETE)',\s*'(/admin/[^']+)',\s*'([a-z0-9-]+)',\s*'(VIEW|EDIT|APPROVE|EXPORT)'\)", t):
            s.add((m.group(1), m.group(2)))
            rows.append(m.groups())
    return s, rows


def norm(p):
    return re.sub(r'\{[^}]+\}', '{}', p.lower())


def level(meth, p):
    if meth == 'GET':
        return 'EXPORT' if re.search(r'(export|csv|download)', p) else 'VIEW'
    if re.search(r'(approve|/fix|finalize|/paid|/send|confirm|decide|/close|/pay(/|$))', p):
        return 'APPROVE'
    return 'EDIT'


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    sqlout = sys.argv[sys.argv.index('--sql') + 1] if '--sql' in sys.argv else None
    if sqlout in args:
        args.remove(sqlout)
    root = args[0]
    srcs = [os.path.join(root, 'src')] + args[1:]
    routes = scan(srcs)
    have, rows = mapped(os.path.join(root, 'prisma/migrations'))
    have_n = {(m, norm(p)) for m, p in have}
    by_prefix = {}
    for m, p, task, lv in rows:
        segs = norm(p).split('/')
        for k in range(len(segs), 2, -1):
            by_prefix.setdefault('/'.join(segs[:k]), task)
    sj = json.load(open(os.path.join(root, 'spec/screens.json'), encoding='utf-8'))
    api2tab = {}
    for s in sj.get('screens', []):
        bo = (s.get('bo') or '').lstrip('#/').split('/')[0]
        for a in s.get('apis', []):
            if bo:
                mth, _, pth = a.partition(' ')
                api2tab.setdefault((mth, norm(pth)), bo)
    miss = []
    for r in routes:
        roles = r['roles']
        if not roles or '__SPREAD__' in roles:
            ops_only = True if roles else False
        else:
            ops_only = all(x in OPS for x in roles)
        if not ops_only:
            continue
        if roles == ['SUPER']:
            continue   # SUPER 전용은 GROUPS 에서도 역할 그대로(권한그룹으로 열지 않음)
        p = pattern(r['path'])
        if (r['method'], norm(p)) in have_n:
            continue
        task = api2tab.get((r['method'], norm(p)))
        if not task:
            task = next((tk for rx, tk in OVERRIDE if re.search(rx, p)), None)
        if not task:
            segs = norm(p).split('/')
            for k in range(len(segs) - 1, 3, -1):
                task = by_prefix.get('/'.join(segs[:k]))
                if task:
                    break
        miss.append({**r, 'pattern': p, 'task': task, 'level': level(r['method'], p)})
    print(f'운영 주소 {len(routes)} · 표에 있음 {len(have)} · 빠짐 {len(miss)} · 업무 못 정함 {sum(1 for m in miss if not m["task"])}')
    for m in miss:
        print(f"  {m['method']:6} {m['pattern']:70} {m['task'] or '?':22} {m['level']:7} {','.join(m['roles'])} {m['file']}")
    # R_역할 채우기 — 역할(@Roles)이 열어 주는 주소의 업무 · 수준을 그 역할의 처음 권한그룹에(같은 범위 · GROUPS 대비)
    R = ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT']
    task_of = {}
    for m_, p_, task_, lv_ in rows:
        task_of.setdefault((m_, norm(p_)), set()).add((task_, lv_))
    for m in miss:
        if m['task']:
            task_of.setdefault((m['method'], norm(m['pattern'])), set()).add((m['task'], m['level']))
    items = set()
    for r in routes:
        k = (r['method'], norm(pattern(r['path'])))
        if k not in task_of or not r['roles'] or '__SPREAD__' in r['roles']:
            continue
        for role in r['roles']:
            if role in R:
                for task_, lv_ in task_of[k]:
                    items.add((f'R_{role}', task_, lv_))
        if r['method'] == 'GET' and r['path'].startswith('/admin/acct/') and 'PAYOUT' in r['roles']:
            for task_, lv_ in task_of[k]:
                items.add(('R_ACCOUNTANT', task_, lv_))
    print('R_ 채우기 후보', len(items))
    if sqlout:
        with open(sqlout, 'w', encoding='utf-8') as f:
            vals = [f"  ('{m['method']}', '{m['pattern']}', '{m['task']}', '{m['level']}')" for m in miss if m['task'] and re.match(r'^/admin/[A-Za-z0-9/{}_.-]+$', m['pattern'])]
            f.write('INSERT INTO public.perm_route_map (method, pattern, task_key, level)\nSELECT v.m, v.p, v.t, v.l FROM (VALUES\n' + ',\n'.join(vals) + '\n) AS v(m, p, t, l)\n'
                    ' WHERE EXISTS (SELECT 1 FROM public.perm_tasks k WHERE k.key = v.t)\nON CONFLICT (method, pattern, task_key) DO NOTHING;\n')
            iv = [f"  ('{g}', '{tk}', '{lv}')" for g, tk, lv in sorted(items)]
            f.write('\nINSERT INTO public.perm_role_group_items (group_key, task_key, level)\nSELECT v.g, v.t, v.l FROM (VALUES\n' + ',\n'.join(iv) + '\n) AS v(g, t, l)\n'
                    ' WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = v.g) AND EXISTS (SELECT 1 FROM public.perm_tasks k WHERE k.key = v.t)\nON CONFLICT DO NOTHING;\n')
        print('SQL', sqlout, len(vals), len(iv))


if __name__ == '__main__':
    main()
