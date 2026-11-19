/* D260 (v10.449 ~ 452 · docs/586 ~ 589) ㉗ 장부 보강 — 분개장 · 현금출납장 · 승인 전표 반대 전표(역분개) · 결산 외화 환산 평가 */

/* ── ① 계정 (v10.450 · 452) — 현금(시재) · 외화환산이익 · 외화환산손실 ── */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, draft) VALUES
  ('CASH_HAND',      '현금(시재)',     'ASSET',   '101', '현금',         9,   '사무실 시재 현금 — 현금출납장(v10.450) · 수동 전표로 들고 남', false),
  ('FX_REVAL_GAIN',  '외화환산이익',   'REVENUE', '910', '외화환산이익', 925, '결산 때 외화 받을 돈을 기말 환율로 평가한 이익 — 다음 달 첫날 되돌림(v10.452)', false),
  ('FX_REVAL_LOSS',  '외화환산손실',   'EXPENSE', '955', '외화환산손실', 965, '결산 때 외화 받을 돈을 기말 환율로 평가한 손실 — 다음 달 첫날 되돌림(v10.452)', false)
ON CONFLICT (role) DO NOTHING;

/* ── ② 승인된 수동 전표 반대 전표(역분개 · v10.451 · docs/588) ──
 *   수동 전표(acct_manual_entries APPROVED → acct_entries MANUAL) 하나에 반대 전표 한 장(MANUAL_REVERSE · source_key = 수동 전표 번호).
 *   SUPER · 사유 5자 이상 · 날짜는 원래 전표 날짜 이후 · 마감한 달 · 해는 막음(fn_acct_entries_closed 가 DB 에서도) · 같은 전표 두 번 안 됨(UNIQUE) · 쌓기만. */
CREATE TABLE IF NOT EXISTS public.acct_entry_reversals (
  id                 bigserial PRIMARY KEY,
  manual_id          bigint NOT NULL UNIQUE REFERENCES public.acct_manual_entries(id),
  entry_id           bigint NOT NULL UNIQUE REFERENCES public.acct_entries(id),
  reverse_entry_id   bigint NOT NULL UNIQUE REFERENCES public.acct_entries(id),
  reverse_on         date NOT NULL,
  reason             text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 200),
  created_by         uuid NOT NULL REFERENCES public.accounts(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aer_two CHECK (entry_id <> reverse_entry_id)
);
CREATE INDEX IF NOT EXISTS ix_aer_created ON public.acct_entry_reversals (created_at DESC);
COMMENT ON TABLE public.acct_entry_reversals IS 'v10.451 (D260) 승인된 수동 전표 반대 전표(역분개) — 한 수동 전표에 한 번 · SUPER · 사유 · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_acct_entry_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text; v_entry bigint; v_src text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'ACCT_REVERSE: 반대 전표 기록은 쌓기만 합니다.'; END IF;
  SELECT state, entry_id INTO v_state, v_entry FROM public.acct_manual_entries WHERE id = NEW.manual_id;
  IF v_state IS DISTINCT FROM 'APPROVED' OR v_entry IS DISTINCT FROM NEW.entry_id THEN
    RAISE EXCEPTION 'ACCT_REVERSE: 승인된 수동 전표만 반대 전표를 만듭니다.';
  END IF;
  SELECT source INTO v_src FROM public.acct_entries WHERE id = NEW.reverse_entry_id;
  IF v_src IS DISTINCT FROM 'MANUAL_REVERSE' THEN RAISE EXCEPTION 'ACCT_REVERSE: 반대 전표 종류가 맞지 않습니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_entry_reversal_guard' AND tgrelid = 'public.acct_entry_reversals'::regclass) THEN
    CREATE TRIGGER trg_acct_entry_reversal_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_entry_reversals FOR EACH ROW EXECUTE FUNCTION public.fn_acct_entry_reversal_guard();
  END IF;
END $$;

/* ── ③ 결산 외화 받을 돈 환산 평가(v10.452 · docs/589) ──
 *   달(ym)마다 한 번 — 그 달 말일 기준 아직 못 받은 수출 받을 돈(acct_exports 선적 · 매출 전표 있음 · 말일까지 회수 안 됨)을 기말 환율(SUPER 입력)로 다시 셈.
 *   차이 = round(외화 × 기말 환율) − 선적 때 원화. 이익 → 차변 외상매출금 / 대변 외화환산이익 · 손실 → 차변 외화환산손실 / 대변 외상매출금.
 *   전표 FX_REVAL(말일) + 되돌림 FX_REVAL_REV(다음 달 첫날 · 차대 반대) 를 함께 넣음 → 회수 때 외환차익 · 차손(EXPORT_PAID)은 선적 원화 기준 그대로.
 *   쌓기만 · 마감한 달이면 넣지 못함(fn_acct_entries_closed). */
CREATE TABLE IF NOT EXISTS public.acct_fx_revals (
  id                 bigserial PRIMARY KEY,
  ym                 text NOT NULL UNIQUE CHECK (ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  as_of              date NOT NULL,
  rates              jsonb NOT NULL CHECK (jsonb_typeof(rates) = 'object'),
  items              jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  gain               bigint NOT NULL DEFAULT 0 CHECK (gain >= 0),
  loss               bigint NOT NULL DEFAULT 0 CHECK (loss >= 0),
  entry_id           bigint REFERENCES public.acct_entries(id),
  reverse_entry_id   bigint REFERENCES public.acct_entries(id),
  note               text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by         uuid NOT NULL REFERENCES public.accounts(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_afr_entries CHECK ((gain + loss = 0) = (entry_id IS NULL) AND (entry_id IS NULL) = (reverse_entry_id IS NULL))
);
COMMENT ON TABLE public.acct_fx_revals IS 'v10.452 (D260) 결산 외화 받을 돈 환산 평가 — 달마다 한 번 · 기말 환율 · 평가 전표 + 다음 달 첫날 되돌림 · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_acct_fx_reval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'ACCT_FXREVAL: 환산 평가 기록은 쌓기만 합니다.'; END IF;
  IF NEW.as_of <> (to_date(NEW.ym || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date THEN
    RAISE EXCEPTION 'ACCT_FXREVAL: 평가일은 그 달 말일입니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_fx_reval_guard' AND tgrelid = 'public.acct_fx_revals'::regclass) THEN
    CREATE TRIGGER trg_acct_fx_reval_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_fx_revals FOR EACH ROW EXECUTE FUNCTION public.fn_acct_fx_reval_guard();
  END IF;
END $$;

/* ── ④ ㉕ 업무 권한(D258) — 새 탭 3개 · 처음 변환 그룹(R_PAYOUT 모두 · R_ACCOUNTANT 보기 · 내려받기) · 주소 ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('acct-daybook',  '분개장',        'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 692),
  ('acct-cashbook', '현금출납장',    'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 694),
  ('acct-fxreval',  '외화 환산 평가', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 696)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_PAYOUT', t, l FROM unnest(ARRAY['acct-daybook', 'acct-cashbook', 'acct-fxreval']) t CROSS JOIN unnest(ARRAY['VIEW', 'EDIT', 'APPROVE', 'EXPORT']) l
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ACCOUNTANT', t, l FROM unnest(ARRAY['acct-daybook', 'acct-cashbook', 'acct-fxreval']) t CROSS JOIN unnest(ARRAY['VIEW', 'EXPORT']) l
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET',  '/admin/acct/daybook',             'acct-daybook',  'VIEW'),
  ('GET',  '/admin/acct/daybook/export',      'acct-daybook',  'EXPORT'),
  ('GET',  '/admin/acct/cashbook',            'acct-cashbook', 'VIEW'),
  ('GET',  '/admin/acct/cashbook/export',     'acct-cashbook', 'EXPORT'),
  ('POST', '/admin/acct/manual/{id}/reverse', 'acct-manual',   'APPROVE'),
  ('GET',  '/admin/acct/fx-reval',            'acct-fxreval',  'VIEW'),
  ('GET',  '/admin/acct/fx-reval/preview',    'acct-fxreval',  'VIEW'),
  ('POST', '/admin/acct/fx-reval',            'acct-fxreval',  'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

