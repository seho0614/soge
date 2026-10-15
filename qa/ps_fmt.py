"""PowerShell 파일의 저장 형식을 맞춥니다 — UTF-8(BOM) · 줄 끝.
   Windows PowerShell 5.1 은 BOM 이 없으면 파일을 CP949 로 읽어 한글 문자열이 깨집니다.
   사용: python3 ps_fmt.py [킷 폴더]      (바뀐 파일만 다시 씁니다)"""
import sys, os
K = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002'
RULES = {'dev.ps1': '\n', 'docker/realcheck.ps1': '\r\n', 'docker/native.ps1': '\r\n'}
BOM = b'\xef\xbb\xbf'
for rel, eol in RULES.items():
    p = os.path.join(K, rel)
    raw = open(p, 'rb').read()
    body = raw[3:] if raw.startswith(BOM) else raw
    text = body.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')
    out = BOM + text.replace('\n', eol).encode('utf-8')
    if out != raw:
        open(p, 'wb').write(out)
    print(('고침  ' if out != raw else '그대로 ') + rel, '· BOM · ' + ('CRLF' if eol == '\r\n' else 'LF'), '·', text.count('\n'), '줄')
