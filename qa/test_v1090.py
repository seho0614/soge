"""v10.90 시험 — 검수 기한 넘김 경보(sgb-review-sla) · RDS 메모리 기본값 64MB · 시험 회원 넘김(docs/145)

  KIT=… [API_LOG=로그 파일] python3 -I test_v1090.py

  ① 배치 — sla_alert 가 넘긴 건이 있으면 WARN 「REVIEW_SLA_BREACH 검수 기한 넘김 N건」 · DB 함수 그대로 · 마이그레이션 없음
  ② setup.sh — 필터 /sgb/api "REVIEW_SLA_BREACH" → SGB/ReviewSlaBreach · 경보 sgb-review-sla(합 ≥ 1 · 7200초 · 1회) · RDS_FREE_MEM_MB 기본 64
  ③ 가짜 aws — check 할일 경보 13 · apply yes 필터 5 · 경보 13 · 기한 경보 값
  ④ test_v1072 · v1075 — 글쓴이가 한도에 걸리면 다음 회원으로
  ⑤ (API_LOG 가 있으면) 점검판 API 로그에 REVIEW_SLA_BREACH 줄
"""
import glob, os, re, subprocess, tempfile

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=K):
    p = os.path.join(base, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


S = rd('src/worker/scheduler.service.ts')
blk = S[S.find("case 'sla_alert': {"):]; blk = blk[:blk.find('break;')]
ok('① sla_alert — 넘긴 건이 있으면 WARN REVIEW_SLA_BREACH', "if (r.n > 0) this.log.warn(`REVIEW_SLA_BREACH 검수 기한 넘김 ${r.n}건" in blk and 'SELECT fn_check_sla_alert() AS n' in blk, '')
ok('① 로그 줄에 ERROR 낱말 없음(API 오류 필터와 겹치지 않음)', 'ERROR' not in re.sub(r'REVIEW_SLA_BREACH', '', blk[blk.find('this.log.warn'):]), '')
mig = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('① 마이그레이션 없음 · 152 · 마지막 D114(v10.93 부터 D115 · 153 — test_v1093)', (len(mig), mig[-1] if mig else '') in ((152, 'D114_seed_ad_ends_extend'), (153, 'D115_i18n_base'), (154, 'D116_agent_base'), (155, 'D117_i18n_content_overlay'), (156, 'D118_i18n_auto_translate'), (157, 'D119_i18n_board_on_view'), (158, 'D120_ai_review_shadow'), (159, 'D121_agent_chat'), (160, 'D122_agent_key_admin'), (161, 'D123_profile_consent_single'), (162, 'D124_i18n_profile'), (163, 'D125_i18n_more_targets'), (164, 'D126_i18n_db_text'), (165, 'D127_partner_badge_codes'), (166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (181, 'D143_files_move'), (182, 'D144_open_date'), (183, 'D145_agent_privacy_gate'), (184, 'D146_switch_locks'), (185, 'D147_mail_lock'), (186, 'D148_alimtalk_etax_lock'), (187, 'D149_privacy_ai_ready')), f'{len(mig)}')

SH = os.path.join(K, 'deploy/aws/cloudwatch/setup.sh')
s = rd('deploy/aws/cloudwatch/setup.sh')
ok('② 문법(bash -n)', subprocess.run(['bash', '-n', SH]).returncode == 0, '')
ok('② 필터 /sgb/api "REVIEW_SLA_BREACH" → SGB/ReviewSlaBreach', '--log-group-name /sgb/api --filter-name sgb-ReviewSlaBreach --filter-pattern \'"REVIEW_SLA_BREACH"\'' in s
   and 'metricName=ReviewSlaBreach,metricNamespace=SGB,metricValue=1,defaultValue=0' in s, '')
ok('② 경보 sgb-review-sla — 합 ≥ 1 · 7200초 · 1회', re.search(r'alarm sgb-review-sla +"[^"]+" SGB ReviewSlaBreach "" Sum \$GE 1 7200 1', s) is not None, '')
ok('② RDS_FREE_MEM_MB 기본 64 · 설명도 64', 'RDS_FREE_MEM_MB="${RDS_FREE_MEM_MB:-64}"' in s and 'RDS_FREE_MEM_MB(64)' in s and '200MB' not in s, '')
ok('② 경보 13개라고 적음', '경보 13개' in s, '')

T = tempfile.mkdtemp()
os.makedirs(T + '/bin')
open(T + '/bin/aws', 'w').write(f'''#!/usr/bin/env bash
D={T}
echo "$*" >> $D/calls
case "$1 $2" in
  "sts get-caller-identity") echo 123456789012;;
  "ec2 describe-addresses") echo i-0abc123;;
  "rds describe-db-instances") if [[ "$*" == *AllocatedStorage* ]]; then echo 20; else echo sgb-db; fi;;
  "sns list-topics") echo arn:aws:sns:ap-northeast-2:1:sgb-alerts;;
  "sns list-subscriptions-by-topic") echo a@b.c;;
  "logs describe-log-groups") echo /sgb/x;;
  "cloudwatch describe-alarms") grep -c alarm $D/state 2>/dev/null || echo 0;;
  "cloudwatch put-metric-alarm") echo alarm >> $D/state;;
esac
''')
os.chmod(T + '/bin/aws', 0o755)
env = dict(os.environ, PATH=T + '/bin:' + os.environ['PATH'], ALERT_EMAIL='a@b.c', RDS_MAX_CONNECTIONS='81')
env.pop('RDS_FREE_MEM_MB', None)


def run(mode, inp=''):
    open(T + '/calls', 'w').close()
    r = subprocess.run(['bash', SH, mode], input=inp, capture_output=True, text=True, env=env)
    return r, open(T + '/calls').read()


r, c = run('check')
ok('③ check — 할일 경보 13 · 기한 필터 · 바꾸는 명령 0', r.returncode == 0 and r.stdout.count('할일 경보') == 13 and 'SGB/ReviewSlaBreach' in r.stdout
   and 'put-metric' not in c, r.stderr[-200:])
r, c = run('apply', 'yes\n')
pf = re.findall(r'^logs put-metric-filter .*', c, re.M); pa = re.findall(r'^cloudwatch put-metric-alarm .*', c, re.M)
ok('③ apply yes — 필터 5 · 경보 13', r.returncode == 0 and len(pf) == 5 and len(pa) == 13, f'{len(pf)} · {len(pa)}')
sla = [l for l in pa if '--alarm-name sgb-review-sla ' in l]
ok('③ 기한 경보 — SGB/ReviewSlaBreach · Sum · ≥ 1 · 7200 · 1 · 울릴 때 · 풀릴 때 메일 · 값 없으면 정상', len(sla) == 1 and all(x in sla[0] for x in (
    '--namespace SGB', '--metric-name ReviewSlaBreach', '--statistic Sum', '--comparison-operator GreaterThanOrEqualToThreshold', '--threshold 1 ',
    '--period 7200', '--evaluation-periods 1', '--treat-missing-data notBreaching', '--alarm-actions arn:', '--ok-actions arn:')), sla[0][:200] if sla else '')
mem = [l for l in pa if '--alarm-name sgb-rds-mem ' in l]
ok('③ RDS 메모리 경보 — 값을 안 주면 64MB', mem and f'--threshold {64 * 1024 * 1024} ' in mem[0], '')

Q = os.path.dirname(os.path.abspath(__file__))
for t in ('test_v1072.py', 'test_v1075.py'):
    q = rd(t, Q)
    ok(f'④ {t} — 한도에 걸리면 다음 회원으로(person → intro → seller)', "for who in [os.environ.get('MEMBER', 'person@x.com'), 'intro@x.com', 'seller@x.com']:" in q
       and "call('POST', '/me/community/posts', WR," in q and "call('POST', '/me/community/posts', MEM," not in q, '')

LOG = os.environ.get('API_LOG')
if LOG:
    L = open(LOG, encoding='utf-8', errors='replace').read()
    hit = [l for l in L.splitlines() if 'REVIEW_SLA_BREACH' in l]
    ok('⑤ 점검판 API 로그에 REVIEW_SLA_BREACH 줄 · WARN · ERROR 낱말 없음', hit and 'WARN' in hit[-1] and 'ERROR' not in hit[-1].replace('REVIEW_SLA_BREACH', ''), hit[-1][-160:] if hit else '없음')

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.90 이상', _v >= (10, 90), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
