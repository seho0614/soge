#!/usr/bin/env python3
"""v10.353 (docs/487) — 운영 화면 막힌 접속 요약(루트 타이머 sgb-nginx-deny 가 10분마다)

  운영 화면 전용 접속 기록(sgb-admin-access.log · 기본 combined 모양)에서 Nginx 가 막은 403 만 셉니다.
  /api/ 주소는 뺍니다(프로그램이 돌려준 403 일 수 있음 — 허용 밖이면 화면 주소에서 먼저 막힘).
  최근 7일(기록 파일 · .1 · .2.gz ~ .7.gz) · IP 마다 7일 · 24시간 · 마지막 때 · 주소 3개 · 상위 50 → 결과 폴더 denied.json(644).
  요청 글을 실행하지 않고, 결과에는 IP · 주소(앞 80자) · 숫자만 씁니다.
"""
import datetime
import glob
import gzip
import json
import os
import re
import tempfile

LOG = os.environ.get('SGB_DENY_LOG', '/var/log/nginx/sgb-admin-access.log')
OUT = os.environ.get('SGB_DENY_OUT', '/var/lib/sgb-nginx-allow')
LINE = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(?:[A-Z]+) (\S+)[^"]*" (\d{3}) ')
IP = re.compile(r'^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{2,39}$')


def lines(path):
    op = gzip.open if path.endswith('.gz') else open
    try:
        with op(path, 'rt', encoding='utf-8', errors='replace') as f:
            for ln in f:
                yield ln
    except OSError:
        return


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    files = [p for p in [LOG, LOG + '.1'] + sorted(glob.glob(LOG + '.*.gz')) if os.path.isfile(p) and not os.path.islink(p)]
    rows, total = {}, 0
    for p in files:
        for ln in lines(p):
            m = LINE.match(ln)
            if not m or m.group(4) != '403' or m.group(3).startswith('/api/'):
                continue
            ip = m.group(1)
            if not IP.match(ip):
                continue
            try:
                t = datetime.datetime.strptime(m.group(2), '%d/%b/%Y:%H:%M:%S %z')
            except ValueError:
                continue
            age = (now - t).total_seconds()
            if age > 7 * 86400 or age < -300:
                continue
            total += 1
            r = rows.setdefault(ip, {'ip': ip, 'n7': 0, 'n24': 0, 'last': t, 'paths': {}})
            r['n7'] += 1
            if age <= 86400:
                r['n24'] += 1
            if t > r['last']:
                r['last'] = t
            path = m.group(3)[:80]
            r['paths'][path] = r['paths'].get(path, 0) + 1
    top = sorted(rows.values(), key=lambda r: (-r['n7'], -r['n24'], r['ip']))[:50]
    out = {
        'at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'days': 7, 'files': len(files), 'total7': total,
        'rows': [{'ip': r['ip'], 'n7': r['n7'], 'n24': r['n24'], 'last': r['last'].astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                  'paths': [k for k, _ in sorted(r['paths'].items(), key=lambda kv: -kv[1])[:3]]} for r in top],
    }
    os.makedirs(OUT, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.d.', dir=OUT)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    os.chmod(tmp, 0o644)
    os.replace(tmp, os.path.join(OUT, 'denied.json'))
    print(f'denied 7일 {total}번 · IP {len(rows)}곳 · 파일 {len(files)}')


if __name__ == '__main__':
    main()
