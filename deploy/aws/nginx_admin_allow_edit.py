#!/usr/bin/env python3
"""v10.348 (docs/482) — Nginx 사이트 파일에서 운영 화면 server 블록의 allow · deny 줄을 include 한 줄로 바꾼 글을 만듭니다(파일은 쓰지 않음).

  python3 nginx_admin_allow_edit.py <사이트 파일> <운영 화면 주소> <새 사이트 파일> <허용 파일>
  · 운영 화면 주소가 server_name 에 든 server 블록만 바꿉니다(사용자 웹 블록은 그대로).
  · 붙어 있는 allow · deny 줄 묶음마다 첫 줄 자리에 `include <허용 파일 경로>;` 한 줄(들여쓰기 그대로) · 나머지 allow · deny 줄은 지움.
  · 모은 allow IP(겹침 없이) + deny all; 을 <허용 파일>에 씀.
  · 끝 줄: `RESULT <바꾼 묶음 수> <IP 수> <IP,…>` · 이미 include 가 있으면 `RESULT READY` · 못 찾으면 종료 코드 1
"""
import re
import sys

INC = '/etc/nginx/snippets/sgb-admin-allow.conf'
ALLOW = re.compile(r'^\s*allow\s+([0-9A-Fa-f:./]+)\s*;\s*(#.*)?$')
DENY = re.compile(r'^\s*deny\s+all\s*;\s*(#.*)?$')


def main(src, admin, out_site, out_allow):
    lines = open(src, encoding='utf-8').read().split('\n')
    if any(f'include {INC};' in l for l in lines):
        print('RESULT READY')
        return 0
    blocks, depth, start = [], 0, None
    for i, l in enumerate(lines):
        code = l.split('#', 1)[0]
        if depth == 0 and re.match(r'^\s*server\s*\{', code):
            start = i
        depth += code.count('{') - code.count('}')
        if start is not None and depth == 0:
            blocks.append((start, i)); start = None
    target = set()
    for a, b in blocks:
        if any(re.match(r'^\s*server_name\s', l) and admin in l.split('#', 1)[0].split() + [x.rstrip(';') for x in l.split('#', 1)[0].split()] for l in lines[a:b + 1]):
            target.update(range(a, b + 1))
    if not target:
        print(f'!! server_name {admin} 인 server 블록이 없습니다', file=sys.stderr)
        return 1
    out, ips, runs, i = [], [], 0, 0
    while i < len(lines):
        l = lines[i]
        if i in target and (ALLOW.match(l) or DENY.match(l)):
            indent = re.match(r'^(\s*)', l).group(1)
            j = i
            while j < len(lines) and j in target and (ALLOW.match(lines[j]) or DENY.match(lines[j])):
                m = ALLOW.match(lines[j])
                if m and m.group(1) not in ips:
                    ips.append(m.group(1))
                j += 1
            out.append(f'{indent}include {INC};   # v10.348 운영 화면 허용 IP — 운영 화면 › 권한 계층 › 접속 인증')
            runs += 1
            i = j
            continue
        out.append(l)
        i += 1
    if not runs or not ips:
        print('!! 운영 화면 블록에서 allow 줄을 찾지 못했습니다', file=sys.stderr)
        return 1
    open(out_site, 'w', encoding='utf-8').write('\n'.join(out))
    open(out_allow, 'w', encoding='utf-8').write(
        '# sgb-admin-allow setup — 처음 준비 때 지금 사이트 파일에서 옮김(이후 운영 화면 「Nginx 반영」 스크립트가 덮어씀)\n'
        + ''.join(f'allow {ip};\n' for ip in ips) + 'deny all;\n')
    print(f'RESULT {runs} {len(ips)} {",".join(ips)}')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr); sys.exit(2)
    sys.exit(main(*sys.argv[1:]))
