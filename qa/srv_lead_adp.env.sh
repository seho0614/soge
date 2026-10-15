export BANK_VERIFY_KEY=bank-test-key BANK_VERIFY_URL=http://127.0.0.1:13023/bank/v1 BANK_VERIFY_SEND_PATH=/one-won BANK_VERIFY_AUTH_PREFIX='KEY ' BANK_VERIFY_TIMEOUT_MS=1000
export BANK_VERIFY_MAP='{"req.bankCode":"data.bank_cd","req.accountNo":"data.acct_no","req.holderName":"data.acct_nm","res.success":"rsp_code","res.successValue":"A0000","res.code":"data.auth_code","res.txId":"data.tran_id","res.holderName":"data.acct_nm","res.errorCode":"rsp_code","res.errorMessage":"rsp_message"}'
export BANK_VERIFY_ERROR_MESSAGES='{"E101":"계좌번호를 확인해 주십시오 (시험 문구)"}'
export BROKER_LOOKUP_URL=http://127.0.0.1:13023/broker/search BROKER_LOOKUP_KEY=broker-test-key BROKER_LOOKUP_KEY_PARAM=apiKey
export BROKER_LOOKUP_PARAMS='{"licenseNo":"regNo"}' BROKER_LOOKUP_EXTRA='{"format":"json"}'
export BROKER_LOOKUP_RESULT_PATH=response.header.resultCode BROKER_LOOKUP_RESULT_OK=00 BROKER_LOOKUP_ITEMS_PATH=response.body.items
export BROKER_LOOKUP_FIELDS='{"licenseNo":"regNo","officeName":"officeNm","ceoName":"ceoNm","status":"sttus"}' BROKER_LOOKUP_ACTIVE=영업중 BROKER_LOOKUP_TIMEOUT_MS=1000
export NTS_SERVICE_KEY=nts-test-key NTS_API_BASE=http://127.0.0.1:13023/nts NTS_TIMEOUT_MS=1000
