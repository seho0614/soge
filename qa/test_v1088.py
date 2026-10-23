"""v10.88 시험 — CloudWatch 경보 · 로그(deploy/aws/cloudwatch · docs/142)

  KIT=… python3 test_v1088.py

  ① 파일 · 문법 — setup.sh(bash -n) · agent.json(JSON)
  ② agent.json — pm2 이름(sgb · sgb-site · sgb-jobs)의 out · error 로그 6개 + Nginx 오류 로그 · 로그 그룹 4개 · 보관 30일 · 메모리 · 디스크(/)
  ③ setup.sh — 경보 12개 이름 · 지우는 명령 없음 · 받는 메일을 파일에 적지 않음(실행 때 ALERT_EMAIL)
  ④ 가짜 aws 로 돌림 — check 는 바꾸지 않음 · apply 에 no 면 바꾸지 않음 · yes 면 주제 1 · 구독 1 · 필터 4 · 경보 12 · test 는 set-alarm-state 1번
  실제 AWS 에 만드는 시험은 하지 않습니다(docs/142 4-3 check 가 처음 확인).
"""
import json, os, re, subprocess, tempfile

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
D = os.path.join(K, 'deploy/aws/cloudwatch')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


SH = os.path.join(D, 'setup.sh')
s = rd('deploy/aws/cloudwatch/setup.sh')
ok('① setup.sh 있음 · bash 문법', s and subprocess.run(['bash', '-n', SH]).returncode == 0, '')
try:
    A = json.loads(rd('deploy/aws/cloudwatch/agent.json'))
except Exception as e:
    A = {}
ok('① agent.json JSON', bool(A), '')

# ②
files = A.get('logs', {}).get('logs_collected', {}).get('files', {}).get('collect_list', [])
paths = {f['file_path'] for f in files}
want = {f'/home/ubuntu/.pm2/logs/{p}-{k}.log' for p in ('sgb', 'sgb-site', 'sgb-jobs') for k in ('out', 'error')} | {'/var/log/nginx/error.log'}
ok('② 로그 파일 7개(pm2 out · error 6 + Nginx 오류)', paths == want, ' · '.join(sorted(paths ^ want)))
pm2 = set(re.findall(r'프로세스 이름 ([\w-]+)', rd('deploy/aws/run-api.sh') + rd('deploy/aws/run-site.sh') + rd('deploy/aws/run-jobs.sh')))
ok('② pm2 이름이 실행 스크립트와 같음(sgb · sgb-site · sgb-jobs)', pm2 == {'sgb', 'sgb-site', 'sgb-jobs'}, ' · '.join(sorted(pm2)))
groups = {f['log_group_name'] for f in files}
ok('② 로그 그룹 4개 · 모두 보관 30일', groups == {'/sgb/api', '/sgb/site', '/sgb/jobs', '/sgb/nginx-error'} and all(f.get('retention_in_days') == 30 for f in files), ' · '.join(sorted(groups)))
m = A.get('metrics', {}).get('metrics_collected', {})
ok('② 메모리 · 디스크(/) · InstanceId 로 묶음', m.get('mem', {}).get('measurement') == ['mem_used_percent'] and m.get('disk', {}).get('resources') == ['/']
   and A['metrics'].get('aggregation_dimensions') == [['InstanceId']], '')
ok('② 로그 그룹이 setup.sh 의 필터와 같음', all(g in s for g in groups), '')

# ③
names = sorted(set(re.findall(r'\balarm (sgb-[a-z0-9-]+)', s)) | {f'sgb-log-{x}' for x in ('api', 'site', 'jobs', 'nginx') if 'sgb-log-' in s})
want_a = sorted(['sgb-ec2-cpu', 'sgb-ec2-status', 'sgb-ec2-mem', 'sgb-ec2-disk', 'sgb-rds-cpu', 'sgb-rds-conn', 'sgb-rds-storage', 'sgb-rds-mem',
                 'sgb-log-api', 'sgb-log-site', 'sgb-log-jobs', 'sgb-log-nginx'])
ok('③ 경보 12개 이름', names == want_a, ' · '.join(sorted(set(names) ^ set(want_a))))
ok('③ 지우는 명령 없음(delete-*)', not re.search(r'\baws\b[^\n]*delete-|do_ [a-z]+ delete-', s), '')
ok('③ 받는 메일을 파일에 적지 않음', not re.search(r'[\w.]+@[\w-]+\.[a-z]{2,}', s), '')

# ④ 가짜 aws
T = tempfile.mkdtemp()
os.makedirs(T + '/bin')
open(T + '/bin/aws', 'w').write(f'''#!/usr/bin/env bash
D={T}
echo "$*" >> $D/calls
case "$1 $2" in
  "sts get-caller-identity") echo 123456789012;;
  "ec2 describe-addresses") echo i-0abc123;;
  "rds describe-db-instances") if [[ "$*" == *AllocatedStorage* ]]; then echo 20; else echo sgb-db; fi;;
  "sns list-topics") grep -q topic $D/state 2>/dev/null && echo arn:aws:sns:ap-northeast-2:1:sgb-alerts || echo None;;
  "sns create-topic") echo topic >> $D/state; echo arn:aws:sns:ap-northeast-2:1:sgb-alerts;;
  "logs describe-log-groups") echo None;;
  "cloudwatch describe-alarms") grep -c alarm $D/state 2>/dev/null || echo 0;;
  "cloudwatch put-metric-alarm") echo alarm >> $D/state;;
esac
''')
os.chmod(T + '/bin/aws', 0o755)
env = dict(os.environ, PATH=T + '/bin:' + os.environ['PATH'], ALERT_EMAIL='a@b.c', RDS_MAX_CONNECTIONS='100')
MUT = re.compile(r'^(sns (create-topic|subscribe)|logs (create-log-group|put-retention-policy|put-metric-filter)|cloudwatch (put-metric-alarm|set-alarm-state))', re.M)


def run(mode, inp=''):
    open(T + '/calls', 'w').close()
    r = subprocess.run(['bash', SH, mode], input=inp, capture_output=True, text=True, env=env)
    return r, open(T + '/calls').read()


r, c = run('check')
ok('④ check — 바꾸는 명령 0 · 할일 경보 12', r.returncode == 0 and not MUT.search(c) and r.stdout.count('할일 경보') == 12, r.stderr[-200:])
r, c = run('apply', 'no\n')
ok('④ apply 에 no — 바꾸는 명령 0', r.returncode != 0 and not MUT.search(c), '')
r, c = run('apply', 'yes\n')
cnt = {k: len(re.findall(rf'^{k}', c, re.M)) for k in ('sns create-topic', 'sns subscribe', 'logs put-metric-filter', 'cloudwatch put-metric-alarm')}
ok('④ apply 에 yes — 주제 1 · 구독 1 · 필터 4 · 경보 12', r.returncode == 0 and list(cnt.values()) == [1, 1, 4, 12], str(cnt))
ok('④ 경보마다 울릴 때 · 풀릴 때 메일(alarm · ok actions)', all('--alarm-actions arn:' in l and '--ok-actions arn:' in l for l in c.splitlines() if l.startswith('cloudwatch put-metric-alarm')), '')
ok('④ 연결 수 경보 = max_connections 의 80%', re.search(r'sgb-rds-conn .*--threshold 80 ', c) is not None, '')
r, c = run('test')
ok('④ test — set-alarm-state 1번(sgb-ec2-cpu)', r.returncode == 0 and c.count('cloudwatch set-alarm-state --alarm-name sgb-ec2-cpu') == 1, '')

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.88 이상', _v >= (10, 88), '.'.join(map(str, _v)))
ok('문서 142', any(f.startswith('142_') for f in os.listdir(os.path.join(K, 'docs'))), '')
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
