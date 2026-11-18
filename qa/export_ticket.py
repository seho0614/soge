"""v10.366 (D238 · docs/501) — 개인정보 대량 내려받기 승인 번호를 시험에서 받습니다.

내려받기 API 4곳(포인트 신고 자료 · 감사 기록 CSV · 공지 읽음 CSV · 요율 공지 읽음 CSV)은 ?ticket=<승인 번호> 가 있어야 열립니다.
쓰는 법:  tk = __import__('export_ticket').get(요청자 증표, 'AUDIT_EXPORT', 승인할 SUPER 증표)  →  f'...&ticket={tk}'
  · 요청자가 SUPER 이고 다른 SUPER 가 없으면 요청 때 스스로 승인(solo) — 승인 증표는 쓰지 않음
  · 기다림이면 승인할 SUPER 증표로 승인(요청자와 같은 사람이면 서버가 422 — 그때는 None)
번호는 한 번 쓰면 끝입니다(실패한 내려받기는 쓰지 않은 것으로 남음). API 주소는 환경 값 API.
"""
import json, os, urllib.error, urllib.request


def _base():
    a = (os.environ.get('API') or 'http://localhost:13000/api/v1').rstrip('/')
    return a if a.endswith('/api/v1') else a + '/api/v1'


def _call(m, p, tok, body=None):
    h = {'content-type': 'application/json'}
    if tok:
        h['authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(_base() + p, method=m, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


def get(tok, target, approver=None, reason='시험 내려받기'):
    r = _call('POST', '/admin/export-requests', tok, {'target': target, 'reason': reason})
    if r.get('_err') or not r.get('id'):
        return None
    if r.get('state') == 'APPROVED':
        return r['id']
    if approver:
        d = _call('POST', f"/admin/export-requests/{r['id']}/decide", approver, {'approve': True})
        if d.get('state') == 'APPROVED':
            return r['id']
    return None
