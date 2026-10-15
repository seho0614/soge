"""srv_lead 용 가짜 외부 서버 (계좌인증 · 중개사무소 조회 · 국세청 상태조회).

  python3 srv_lead_mock.py [포트=13023]

★ 계좌인증 · 중개사무소 응답의 필드 이름은 **시험용으로 정한 것**이지 실제 업체 형식이 아닙니다.
  어댑터가 설정(BANK_VERIFY_MAP · BROKER_LOOKUP_*)대로 읽는지를 보려고 일부러 중첩 · 다른 이름을 씁니다.
★ 국세청은 공공데이터포털 nts-businessman/v1/status 의 응답 모양(status_code · data[].b_stt_cd …)을 따릅니다.

받은 요청은 /_log 로 돌려줍니다(키가 헤더 · 쿼리에 실렸는지 확인용).
"""
import json, sys, time, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 13023
LOG = []
LOCK = threading.Lock()

BROKERS = [  # 시험용 등록 사무소
    {'regNo': '11545-2026-10001', 'officeNm': '가산공인중개사사무소', 'ceoNm': '김시험', 'sttus': '영업중'},
    {'regNo': '11545-2026-10002', 'officeNm': '구로공인중개사사무소', 'ceoNm': '이시험', 'sttus': '영업중'},
    {'regNo': '11545-2026-10003', 'officeNm': '휴업공인중개사사무소', 'ceoNm': '박시험', 'sttus': '휴업'},
]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj, raw=None):
        b = raw if raw is not None else json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json; charset=utf-8')
        self.send_header('content-length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get('content-length') or 0)
        try:
            return json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            return None

    def _log(self, body):
        with LOCK:
            LOG.append({'method': self.command, 'path': self.path, 'auth': self.headers.get('authorization'),
                        'body': body})
            del LOG[:-200]

    def do_GET(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == '/_log':
            return self._send(200, LOG)
        self._log(None)
        if u.path == '/broker/search':
            if q.get('apiKey') != 'broker-test-key':
                return self._send(401, {'response': {'header': {'resultCode': '30', 'resultMsg': 'KEY ERROR'}}})
            reg = q.get('regNo', '')
            if reg.endswith('-99998'):
                time.sleep(3); return self._send(200, {'response': {'header': {'resultCode': '00'}, 'body': {'items': []}}})
            if reg.endswith('-99997'):
                return self._send(500, {'error': 'internal'})
            if reg.endswith('-99996'):
                return self._send(200, None, raw=b'<html>not json</html>')
            if reg.endswith('-99995'):
                return self._send(200, {'response': {'header': {'resultCode': '22', 'resultMsg': 'LIMITED'}}})
            items = [b for b in BROKERS if b['regNo'].replace('-', '') == reg.replace('-', '')]
            # 한 건이면 배열이 아니라 객체로 주는 기관이 있습니다 — 어댑터가 둘 다 받는지 봅니다
            body = {'items': items[0] if len(items) == 1 else items}
            return self._send(200, {'response': {'header': {'resultCode': '00', 'resultMsg': 'OK'}, 'body': body}})
        return self._send(404, {'error': 'no route'})

    def do_POST(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        body = self._body()
        self._log(body)
        if u.path == '/bank/v1/one-won':
            if self.headers.get('authorization') != 'KEY bank-test-key':
                return self._send(401, {'rsp_code': 'E401', 'rsp_message': 'unauthorized'})
            d = (body or {}).get('data') or {}
            acct = str(d.get('acct_no', ''))
            if acct.endswith('9999'):
                time.sleep(3)
            if acct.endswith('5000'):
                return self._send(503, {'rsp_code': 'E500', 'rsp_message': 'bank down'})
            if acct.endswith('0000'):
                return self._send(200, {'rsp_code': 'E101', 'rsp_message': 'invalid account'})
            if acct.endswith('4000'):
                return self._send(400, {'rsp_code': 'E102', 'rsp_message': 'bank code mismatch'})
            holder = '다른사람' if acct.endswith('7777') else d.get('acct_nm')
            return self._send(200, {'rsp_code': 'A0000', 'rsp_message': 'OK',
                                    'data': {'auth_code': '4821', 'tran_id': 'T' + acct[-4:], 'acct_nm': holder}})
        if u.path == '/nts/status':
            if not q.get('serviceKey') or q.get('returnType') != 'JSON':
                return self._send(401, {'status_code': 'ERR', 'message': 'key'})
            bno = ((body or {}).get('b_no') or [''])[0]
            tail = bno[-2:]
            if tail == '06':
                time.sleep(3)
            if tail == '05':
                return self._send(500, {'status_code': 'ERR'})
            common = {'tax_type_cd': '', 'end_dt': '', 'utcc_yn': 'N', 'tax_type_change_dt': '',
                      'invoice_apply_dt': '', 'rbf_tax_type': '', 'rbf_tax_type_cd': ''}
            row = {'01': {'b_stt': '계속사업자', 'b_stt_cd': '01', 'tax_type': '부가가치세 일반과세자', 'tax_type_cd': '01'},
                   '02': {'b_stt': '휴업자', 'b_stt_cd': '02', 'tax_type': '부가가치세 일반과세자', 'tax_type_cd': '01'},
                   '03': {'b_stt': '폐업자', 'b_stt_cd': '03', 'tax_type': '부가가치세 일반과세자', 'tax_type_cd': '01', 'end_dt': '20251231'},
                   }.get(tail, {'b_stt': '', 'b_stt_cd': '', 'tax_type': '국세청에 등록되지 않은 사업자등록번호입니다.', 'utcc_yn': ''})
            data = [{**common, 'b_no': bno, **row}]
            return self._send(200, {'request_cnt': 1, 'match_cnt': 1 if row.get('b_stt_cd') else 0,
                                    'status_code': 'OK', 'data': data})
        return self._send(404, {'error': 'no route'})


if __name__ == '__main__':
    print(f'mock on {PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
