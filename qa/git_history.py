"""전달했던 킷 묶음(zip)을 시간 순서대로 git 기록으로 — 킷 작업본에 저장소를 (다시) 만듭니다.  python3 git_history.py
   각 커밋 = 그때 전달한 zip 의 내용 그대로(날짜도 그때) · 태그 = 판 이름. 마지막에 지금 작업본은 따로 커밋합니다."""
import os, re, glob, shutil, subprocess, zipfile, datetime
K = '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'; O = '/mnt/user-data/outputs'; T = '/tmp/git_hist'
TR = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_013QnXMHTRvpxoVERnB7CobY'
def g(*a, env=None, wt=None):
    e = dict(os.environ, **(env or {}))
    if wt: e['GIT_WORK_TREE'] = wt
    return subprocess.run(['git', *a], cwd=K, env=e, check=True, capture_output=True, text=True).stdout
zips = sorted(glob.glob(O + '/SGB_DevDocker_Integrated_*.zip'), key=os.path.getmtime)
shutil.rmtree(K + '/.git', ignore_errors=True)
g('init', '-q', '-b', 'main')
for k, v in (('user.name', 'Claude (소개뱅크 킷)'), ('user.email', 'noreply@anthropic.com'), ('core.autocrlf', 'false'), ('core.quotepath', 'false')): g('config', k, v)
gi = open(K + '/.gitignore', encoding='utf-8').read()
for z in zips:
    base = os.path.basename(z)[:-4]; m = re.search(r'Integrated_(\d{8})(?:_(v[\d_]+?))?(_FINAL|_r2)?$', base)
    ver = m.group(2).replace('_', '.') if m.group(2) else 'kit-' + m.group(1)
    tag = ver + ('-final' if m.group(3) == '_FINAL' else '-r2' if m.group(3) == '_r2' else '')
    shutil.rmtree(T, ignore_errors=True); os.makedirs(T)
    with zipfile.ZipFile(z) as f: f.extractall(T)
    # zipfile 은 실행 권한을 풀지 않으므로 zip 의 권한 정보를 되살립니다
    with zipfile.ZipFile(z) as f:
        for i in f.infolist():
            mode = i.external_attr >> 16
            if mode and not i.is_dir(): os.chmod(os.path.join(T, i.filename), mode & 0o777)
    tops = os.listdir(T); wt = os.path.join(T, tops[0]) if len(tops) == 1 and os.path.isdir(os.path.join(T, tops[0])) else T
    open(wt + '/.gitignore', 'w', encoding='utf-8').write(gi)
    g('add', '-A', wt=wt)
    when = datetime.datetime.fromtimestamp(os.path.getmtime(z)).strftime('%Y-%m-%dT%H:%M:%S+09:00')
    g('commit', '-q', '--allow-empty', '-m', f'{tag} — 전달한 묶음 {os.path.basename(z)} 그대로' + TR, wt=wt, env={'GIT_AUTHOR_DATE': when, 'GIT_COMMITTER_DATE': when})
    g('tag', tag)
    print(tag, os.path.basename(z), sum(len(fs) for _, _, fs in os.walk(wt)))
shutil.rmtree(T, ignore_errors=True)
print(g('log', '--oneline').count('\n'), '커밋')
