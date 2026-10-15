-- =====================================================================
-- B040_tables
--
-- 테이블 70개와 시퀀스. 컬럼에 없는 것이 곧 설계입니다 — 공제·계좌 컬럼이 없습니다(INV-9R · INV-11).
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

CREATE TABLE audit.audit_logs (
    id bigint NOT NULL,
    actor_account_id uuid,
    actor_role text,
    action text NOT NULL,
    target_type text,
    target_id uuid,
    before_data jsonb,
    after_data jsonb,
    ip inet,
    user_agent text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE audit.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE audit.audit_logs_id_seq OWNED BY audit.audit_logs.id;

CREATE TABLE audit.pii_access_logs (
    id bigint NOT NULL,
    actor_account_id uuid NOT NULL,
    lead_id uuid,
    access_type text NOT NULL,
    reason text,
    ip inet,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    target_account_id uuid,
    target_type text DEFAULT 'LEAD'::text NOT NULL,
    CONSTRAINT pii_access_logs_access_type_check CHECK ((access_type = ANY (ARRAY['VIEW'::text, 'EXPORT'::text, 'UPDATE'::text, 'PURGE'::text])))
);

CREATE SEQUENCE audit.pii_access_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE audit.pii_access_logs_id_seq OWNED BY audit.pii_access_logs.id;

CREATE TABLE public._t (
    code text,
    version text,
    status text,
    effective_from timestamp with time zone
);

CREATE TABLE public.account_roles (
    account_id uuid NOT NULL,
    role text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_roles_role_check CHECK ((role = ANY (ARRAY['MEMBER'::text, 'BIZ_OWNER'::text, 'BIZ_STAFF'::text, 'REVIEWER'::text, 'ADMIN'::text, 'PAYOUT'::text, 'SUPER'::text])))
);

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    phone text,
    account_type text DEFAULT 'INDIVIDUAL'::text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    identity_verified_at timestamp with time zone,
    last_login_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    purged_at timestamp with time zone,
    retention_until date,
    CONSTRAINT accounts_account_type_check CHECK ((account_type = ANY (ARRAY['INDIVIDUAL'::text, 'BUSINESS'::text, 'PERSONAL'::text, 'SOLE'::text, 'CORP'::text]))),
    CONSTRAINT accounts_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text, 'WITHDRAWN'::text])))
);

CREATE TABLE public.ad_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_code text NOT NULL,
    product_id uuid,
    advertiser_id uuid NOT NULL,
    creative_code text,
    category text,
    period daterange NOT NULL,
    amount numeric NOT NULL,
    status text DEFAULT 'RESERVED'::text NOT NULL,
    expected_impressions integer,
    actual_impressions integer,
    settle_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_precontract boolean DEFAULT false NOT NULL,
    CONSTRAINT ad_bookings_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT ad_bookings_status_check CHECK ((status = ANY (ARRAY['RESERVED'::text, 'CONFIRMED'::text, 'CANCELLED'::text, 'SETTLED'::text, 'HELD'::text])))
);

CREATE TABLE public.ad_creative_segments (
    creative_id uuid NOT NULL,
    segment_code text NOT NULL
);

CREATE TABLE public.ad_events (
    id bigint NOT NULL,
    creative_id uuid NOT NULL,
    slot_code text NOT NULL,
    event_type text NOT NULL,
    account_id uuid,
    segment_code text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    member_hash text,
    anonymized_at timestamp with time zone,
    CONSTRAINT ad_events_event_type_check CHECK ((event_type = ANY (ARRAY['IMPRESSION'::text, 'CLICK'::text])))
);

CREATE SEQUENCE public.ad_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ad_events_id_seq OWNED BY public.ad_events.id;

CREATE SEQUENCE public.ad_invoice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.ad_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_no text NOT NULL,
    advertiser_id uuid NOT NULL,
    booking_id uuid,
    period_from date NOT NULL,
    period_to date NOT NULL,
    amount bigint NOT NULL,
    vat bigint DEFAULT 0 NOT NULL,
    total bigint NOT NULL,
    status text DEFAULT 'ISSUED'::text NOT NULL,
    due_date date NOT NULL,
    paid_at timestamp with time zone,
    paid_amount bigint,
    pay_method text,
    tax_invoice_no text,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_invoices_amount_check CHECK (((amount > 0) AND (total > 0))),
    CONSTRAINT ad_invoices_pay_check CHECK (((pay_method IS NULL) OR (pay_method = ANY (ARRAY['TRANSFER'::text, 'CARD'::text, 'OFFSET'::text])))),
    CONSTRAINT ad_invoices_period_check CHECK ((period_to >= period_from)),
    CONSTRAINT ad_invoices_status_check CHECK ((status = ANY (ARRAY['ISSUED'::text, 'PAID'::text, 'PARTIAL'::text, 'OVERDUE'::text, 'VOID'::text])))
);

CREATE TABLE public.ad_leak_audits (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    leaked_rows integer NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.ad_leak_audits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ad_leak_audits_id_seq OWNED BY public.ad_leak_audits.id;

CREATE TABLE public.ad_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    amount bigint NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    method text DEFAULT 'TRANSFER'::text NOT NULL,
    payer_name text,
    memo text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_payments_amount_check CHECK ((amount > 0)),
    CONSTRAINT ad_payments_method_check CHECK ((method = ANY (ARRAY['TRANSFER'::text, 'CARD'::text, 'OFFSET'::text])))
);

CREATE TABLE public.ad_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_code text,
    advertiser_business_id uuid,
    image_key text,
    link_url text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    status text DEFAULT 'SCHEDULED'::text NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    creative_code text,
    advertiser text,
    category text,
    title text,
    body text,
    cta text,
    landing_route text,
    is_regulated boolean DEFAULT false NOT NULL,
    review_no text,
    review_confirmed_at timestamp with time zone,
    attribution_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT ad_placements_check CHECK ((ends_at > starts_at)),
    CONSTRAINT ad_placements_status_check CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'ACTIVE'::text, 'ENDED'::text, 'PAUSED'::text, 'BLOCKED'::text, 'DRAFT'::text])))
);

CREATE TABLE public.ad_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_code text NOT NULL,
    period_unit text NOT NULL,
    category text,
    list_price numeric NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    note text,
    is_intro_price boolean DEFAULT true NOT NULL,
    CONSTRAINT ad_products_list_price_check CHECK ((list_price >= (0)::numeric)),
    CONSTRAINT ad_products_period_unit_check CHECK ((period_unit = ANY (ARRAY['WEEK'::text, 'MONTH'::text])))
);

CREATE TABLE public.ad_segments (
    code text NOT NULL,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.ad_slots (
    code text NOT NULL,
    gwan_code text,
    name text NOT NULL,
    width integer,
    height integer,
    is_active boolean DEFAULT true NOT NULL,
    placement text,
    spec text,
    in_ranking boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_ad_slot_not_in_ranking CHECK ((in_ranking = false))
);

CREATE TABLE public.ad_waitlist (
    id bigint NOT NULL,
    slot_code text NOT NULL,
    advertiser_id uuid NOT NULL,
    category text,
    requested_for daterange,
    expires_at timestamp with time zone DEFAULT (now() + '90 days'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.ad_waitlist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ad_waitlist_id_seq OWNED BY public.ad_waitlist.id;

CREATE TABLE public.advertisers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    biz_reg_no text,
    ceo_name text,
    contact_name text,
    contact_phone text,
    contact_email text,
    account_id uuid,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT advertisers_biz_check CHECK (((biz_reg_no IS NULL) OR (biz_reg_no ~ '^[0-9]{3}-[0-9]{2}-[0-9]{5}$'::text))),
    CONSTRAINT advertisers_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PAUSED'::text, 'BLOCKED'::text])))
);

CREATE TABLE public.ai_decisions (
    id bigint NOT NULL,
    kind text NOT NULL,
    account_id uuid,
    target_type text,
    target_id uuid,
    input_hash text,
    result jsonb NOT NULL,
    rule_version text,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_decisions_kind_check CHECK ((kind = ANY (ARRAY['PRF'::text, 'CLS'::text, 'REC'::text])))
);

CREATE SEQUENCE public.ai_decisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ai_decisions_id_seq OWNED BY public.ai_decisions.id;

CREATE TABLE public.attribution_events (
    id bigint NOT NULL,
    code text NOT NULL,
    visitor_key text NOT NULL,
    account_id uuid,
    channel text DEFAULT 'WEB'::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    landing_url text,
    referer text,
    ip_hash text,
    raw jsonb,
    source text DEFAULT 'INTRO'::text NOT NULL,
    ad_creative_code text,
    ad_advertiser_biz_id uuid,
    CONSTRAINT attribution_events_channel_check CHECK ((channel = ANY (ARRAY['WEB'::text, 'MOBILE'::text, 'CALL'::text, 'OFFLINE'::text]))),
    CONSTRAINT attribution_events_check CHECK ((expires_at > occurred_at)),
    CONSTRAINT attribution_events_source_check CHECK ((source = ANY (ARRAY['INTRO'::text, 'AD'::text])))
);

CREATE SEQUENCE public.attribution_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.attribution_events_id_seq OWNED BY public.attribution_events.id;

CREATE TABLE public.attribution_policies (
    version integer NOT NULL,
    window_days integer NOT NULL,
    model text NOT NULL,
    allow_channels text[] DEFAULT ARRAY['WEB'::text, 'MOBILE'::text, 'CALL'::text, 'OFFLINE'::text] NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    note text,
    CONSTRAINT attribution_policies_model_check CHECK ((model = ANY (ARRAY['FIRST_TOUCH'::text, 'LAST_TOUCH'::text]))),
    CONSTRAINT attribution_policies_window_days_check CHECK ((window_days > 0))
);

CREATE TABLE public.audit_thresholds (
    code text NOT NULL,
    label text NOT NULL,
    threshold integer NOT NULL,
    window_hrs integer DEFAULT 24 NOT NULL,
    note text,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_thresholds_pos CHECK (((threshold > 0) AND (window_hrs > 0)))
);

CREATE TABLE public.auto_review_policies (
    key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    num_value numeric(14,2),
    text_value text,
    description text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.banned_words (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    word text NOT NULL,
    match_type text DEFAULT 'CONTAINS'::text NOT NULL,
    severity text DEFAULT 'BLOCK'::text NOT NULL,
    gwan_code text,
    is_active boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT banned_words_match_type_check CHECK ((match_type = ANY (ARRAY['EXACT'::text, 'CONTAINS'::text, 'REGEX'::text]))),
    CONSTRAINT banned_words_severity_check CHECK ((severity = ANY (ARRAY['BLOCK'::text, 'WARN'::text]))),
    CONSTRAINT ck_banned_word_not_blank CHECK ((btrim(word) <> ''::text))
);

CREATE TABLE public.billing_attempts (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    amount numeric NOT NULL,
    result text NOT NULL,
    detail text,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT billing_attempts_result_check CHECK ((result = ANY (ARRAY['PAID'::text, 'RETRYABLE'::text, 'TERMINAL'::text, 'NO_METHOD'::text])))
);

CREATE SEQUENCE public.billing_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.billing_attempts_id_seq OWNED BY public.billing_attempts.id;

CREATE TABLE public.billing_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    provider text DEFAULT 'TOSS'::text NOT NULL,
    billing_key text NOT NULL,
    card_company text,
    card_last4 text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    CONSTRAINT billing_keys_card_last4_check CHECK (((card_last4 IS NULL) OR (card_last4 ~ '^[0-9]{4}$'::text))),
    CONSTRAINT billing_keys_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text, 'FAILED'::text])))
);

CREATE TABLE public.broker_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    license_no text NOT NULL,
    office_name text,
    ceo_name text,
    lookup_result text,
    lookup_at timestamp with time zone,
    state text DEFAULT 'SUBMITTED'::text NOT NULL,
    recheck_due date,
    reject_reason text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT broker_verifications_lookup_result_check CHECK ((lookup_result = ANY (ARRAY['MATCH'::text, 'MISMATCH'::text, 'NOT_FOUND'::text]))),
    CONSTRAINT broker_verifications_state_check CHECK ((state = ANY (ARRAY['SUBMITTED'::text, 'PENDING'::text, 'VERIFIED'::text, 'REJECTED'::text, 'EXPIRED'::text])))
);

CREATE TABLE public.business_members (
    business_id uuid NOT NULL,
    account_id uuid NOT NULL,
    member_role text DEFAULT 'STAFF'::text NOT NULL,
    can_settle boolean DEFAULT false NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    joined_at timestamp with time zone,
    CONSTRAINT business_members_member_role_check CHECK ((member_role = ANY (ARRAY['OWNER'::text, 'STAFF'::text])))
);

CREATE TABLE public.businesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    biz_reg_no text NOT NULL,
    company_name text NOT NULL,
    ceo_name text NOT NULL,
    biz_type text,
    biz_item text,
    address text,
    nts_status text,
    nts_checked_at timestamp with time zone,
    broker_license_no text,
    broker_verified_at timestamp with time zone,
    verified_at timestamp with time zone,
    verified_by uuid,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nts_detail text,
    zipcode text,
    address_road text,
    address_jibun text,
    sido text,
    sigungu text,
    address_detail text,
    corp_reg_no text,
    CONSTRAINT businesses_nts_status_check CHECK ((nts_status = ANY (ARRAY['VALID'::text, 'CLOSED'::text, 'SUSPENDED'::text, 'UNKNOWN'::text]))),
    CONSTRAINT ck_biz_zipcode CHECK (((zipcode IS NULL) OR (zipcode ~ '^[0-9]{5}$'::text)))
);

CREATE TABLE public.call_logs (
    id bigint NOT NULL,
    safe_number_id uuid NOT NULL,
    caller_hash text NOT NULL,
    duration_sec integer,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    recording_key text
);

CREATE SEQUENCE public.call_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.call_logs_id_seq OWNED BY public.call_logs.id;

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gwan_code text NOT NULL,
    parent_id uuid,
    code text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    fee_bearer text,
    price_form_type text,
    requested_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    labor_law_flag text,
    labor_law_memo text,
    labor_law_checked_by uuid,
    labor_law_checked_at timestamp with time zone,
    restricted_code text,
    lead_fee numeric,
    lead_fee_provisional boolean DEFAULT true NOT NULL,
    lead_grade text,
    CONSTRAINT categories_fee_bearer_check CHECK ((fee_bearer = ANY (ARRAY['BUYER'::text, 'SELLER'::text, 'NEGOTIABLE'::text]))),
    CONSTRAINT categories_labor_law_flag_check CHECK ((labor_law_flag = ANY (ARRAY['NOT_APPLICABLE'::text, 'REVIEW_REQUIRED'::text, 'APPLICABLE'::text]))),
    CONSTRAINT categories_lead_grade_check CHECK (((lead_grade IS NULL) OR (lead_grade = ANY (ARRAY['S'::text, 'A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text, 'G'::text])))),
    CONSTRAINT categories_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'ARCHIVED'::text]))),
    CONSTRAINT ck_category_lead_fee CHECK (((lead_fee IS NULL) OR ((lead_fee >= (0)::numeric) AND (lead_fee <= (100000)::numeric))))
);

CREATE TABLE public.category_grades (
    category_id uuid NOT NULL,
    grade_code text NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid,
    CONSTRAINT category_grades_grade_code_check CHECK ((grade_code = ANY (ARRAY['G1'::text, 'G2'::text, 'G3'::text])))
);

CREATE TABLE public.category_matrix_axes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    axis_type text NOT NULL,
    axis_key text NOT NULL,
    label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE public.classify_categories (
    code text NOT NULL,
    name text NOT NULL,
    gwan_code text,
    grade text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    category_id uuid
);

CREATE TABLE public.classify_logs (
    id bigint NOT NULL,
    account_id uuid,
    input_text text NOT NULL,
    suggested text,
    score integer,
    matched text[],
    chosen text,
    unclassified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.classify_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.classify_logs_id_seq OWNED BY public.classify_logs.id;

CREATE TABLE public.classify_vocab (
    category_code text NOT NULL,
    term text NOT NULL,
    weight integer NOT NULL,
    CONSTRAINT ck_vocab_len CHECK (((btrim(term) <> ''::text) AND (btrim(term) <> ALL (ARRAY['은'::text, '는'::text, '이'::text, '가'::text, '을'::text, '를'::text, '의'::text, '에'::text, '와'::text, '과'::text, '도'::text, '로'::text, '으로'::text, '그리고'::text, '또는'::text, '및'::text])))),
    CONSTRAINT ck_vocab_not_blank CHECK ((btrim(term) <> ''::text)),
    CONSTRAINT classify_vocab_weight_check CHECK ((weight > 0))
);

CREATE TABLE public.code_labels (
    domain text NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    short_label text,
    description text,
    ui_tone text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    audience text DEFAULT 'ALL'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT code_labels_audience_check CHECK ((audience = ANY (ARRAY['ALL'::text, 'USER'::text, 'ADMIN'::text]))),
    CONSTRAINT code_labels_ui_tone_check CHECK ((ui_tone = ANY (ARRAY['neutral'::text, 'info'::text, 'success'::text, 'warning'::text, 'danger'::text, 'muted'::text])))
);

CREATE TABLE public.collect_fetches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    status text DEFAULT 'RUNNING'::text NOT NULL,
    items integer DEFAULT 0 NOT NULL,
    errors integer DEFAULT 0 NOT NULL,
    note text,
    run_by uuid,
    CONSTRAINT collect_fetches_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'DONE'::text, 'FAILED'::text, 'ABORTED'::text])))
);

CREATE TABLE public.collect_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fetch_id uuid NOT NULL,
    source_id uuid NOT NULL,
    report_no text NOT NULL,
    product_name text NOT NULL,
    raw_material text,
    matched_count integer DEFAULT 0 NOT NULL,
    unmatched text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.collect_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    base_url text NOT NULL,
    kind text DEFAULT 'PUBLIC_API'::text NOT NULL,
    state text DEFAULT 'STOPPED'::text NOT NULL,
    robots_at timestamp with time zone,
    robots_by uuid,
    legal_at timestamp with time zone,
    legal_by uuid,
    legal_note text,
    interval_ms integer DEFAULT 1000 NOT NULL,
    concurrency integer DEFAULT 1 NOT NULL,
    blocked_reason text,
    unblocked_by uuid,
    unblocked_at timestamp with time zone,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collect_sources_kind_check CHECK ((kind = ANY (ARRAY['PUBLIC_API'::text, 'OPEN_DATA'::text, 'PARTNER_FEED'::text]))),
    CONSTRAINT collect_sources_rate_check CHECK (((interval_ms >= 1000) AND (concurrency = 1))),
    CONSTRAINT collect_sources_state_check CHECK ((state = ANY (ARRAY['STOPPED'::text, 'READY'::text, 'RUNNING'::text, 'BLOCKED'::text])))
);

CREATE TABLE public.company_account_changes (
    id bigint NOT NULL,
    changed_by uuid,
    field text NOT NULL,
    before_val text,
    after_val text NOT NULL,
    reason text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.company_account_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.company_account_changes_id_seq OWNED BY public.company_account_changes.id;

CREATE TABLE public.contract_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    from_state text,
    to_state text NOT NULL,
    terms jsonb,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.contract_templates (
    code text NOT NULL,
    name text NOT NULL,
    version text NOT NULL,
    scope text NOT NULL,
    body text NOT NULL,
    invariants text[],
    is_active boolean DEFAULT true NOT NULL,
    effective_from date NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contract_tpl_body_check CHECK ((length(btrim(body)) >= 100)),
    CONSTRAINT contract_tpl_scope_check CHECK ((scope = ANY (ARRAY['INTRO'::text, 'HLT_SELLER'::text, 'PARTNER'::text, 'AD'::text])))
);

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    initiator_id uuid NOT NULL,
    counterpart_id uuid NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone,
    CONSTRAINT conversations_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'DEAL_CREATED'::text, 'CLOSED'::text]))),
    CONSTRAINT conversations_target_type_check CHECK ((target_type = ANY (ARRAY['LISTING'::text, 'REQUEST'::text])))
);

CREATE TABLE public.deal_confirmations (
    deal_id uuid NOT NULL,
    party text NOT NULL,
    confirmed_by uuid,
    is_auto boolean DEFAULT false NOT NULL,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'MANUAL'::text NOT NULL,
    CONSTRAINT deal_confirmations_party_check CHECK ((party = ANY (ARRAY['BUYER'::text, 'SELLER'::text]))),
    CONSTRAINT deal_confirmations_source_check CHECK ((source = ANY (ARRAY['MANUAL'::text, 'AUTO_7D'::text, 'CONTRACT'::text])))
);

CREATE TABLE public.deal_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    template_code text NOT NULL,
    document_key text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_by_buyer_at timestamp with time zone,
    signed_by_seller_at timestamp with time zone,
    fee_agreement_id bigint,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    terms jsonb,
    agreed_by_buyer_at timestamp with time zone,
    agreed_by_seller_at timestamp with time zone,
    fulfilled_by_buyer_at timestamp with time zone,
    fulfilled_by_seller_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    last_actor_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    esign_doc_id text,
    esign_stub boolean DEFAULT false NOT NULL,
    CONSTRAINT deal_contracts_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'SENT'::text, 'COUNTER'::text, 'AGREED'::text, 'SIGNED'::text, 'FULFILLED'::text, 'CANCELLED'::text])))
);

CREATE TABLE public.deal_payment_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    method text NOT NULL,
    evidence_key text,
    reported_by uuid NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    memo text,
    CONSTRAINT deal_payment_records_method_check CHECK ((method = ANY (ARRAY['BANK_TRANSFER'::text, 'CASH'::text, 'OTHER'::text])))
);

CREATE TABLE public.deal_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    author_id uuid NOT NULL,
    target_id uuid NOT NULL,
    rating smallint NOT NULL,
    body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deal_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

CREATE TABLE public.deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    listing_id uuid,
    request_id uuid,
    buyer_account_id uuid NOT NULL,
    seller_account_id uuid NOT NULL,
    introducer_account_id uuid,
    attributed_code text,
    attributed_event_id bigint,
    attributed_at timestamp with time zone,
    tier smallint DEFAULT 1 NOT NULL,
    agreed_fee numeric(14,0),
    agreed_fee_fixed_at timestamp with time zone,
    status text DEFAULT 'INQUIRY'::text NOT NULL,
    confirmed_at timestamp with time zone,
    confirm_mode text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attribution_policy_version integer,
    match_source text DEFAULT 'HUMAN'::text NOT NULL,
    CONSTRAINT ck_deal_confirmed_at CHECK (((status <> 'CONFIRMED'::text) OR (confirmed_at IS NOT NULL))),
    CONSTRAINT ck_deal_not_self CHECK ((buyer_account_id <> seller_account_id)),
    CONSTRAINT deals_check CHECK (((listing_id IS NOT NULL) OR (request_id IS NOT NULL))),
    CONSTRAINT deals_check1 CHECK ((buyer_account_id <> seller_account_id)),
    CONSTRAINT deals_confirm_mode_check CHECK ((confirm_mode = ANY (ARRAY['BOTH'::text, 'AUTO'::text, 'CONTRACT'::text]))),
    CONSTRAINT deals_match_source_check CHECK ((match_source = ANY (ARRAY['HUMAN'::text, 'AI_DIRECT'::text]))),
    CONSTRAINT deals_status_check CHECK ((status = ANY (ARRAY['INQUIRY'::text, 'NEGOTIATING'::text, 'CONTRACTED'::text, 'PAYMENT_REPORTED'::text, 'CONFIRMED'::text, 'SETTLED'::text, 'DISPUTED'::text, 'CANCELLED'::text]))),
    CONSTRAINT deals_tier_check CHECK ((tier = 1))
);

CREATE TABLE public.dispute_messages (
    id bigint NOT NULL,
    dispute_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    attachment_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.dispute_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.dispute_messages_id_seq OWNED BY public.dispute_messages.id;

CREATE TABLE public.disputes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    raised_by uuid NOT NULL,
    reason_code text NOT NULL,
    description text,
    status text DEFAULT 'OPEN'::text NOT NULL,
    resolution text,
    handled_by uuid,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT disputes_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'IN_REVIEW'::text, 'RESOLVED'::text, 'REJECTED'::text])))
);

CREATE TABLE public.event_joins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    account_id uuid NOT NULL,
    memo text,
    granted_at timestamp with time zone,
    granted_by uuid,
    grant_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    summary text,
    body text NOT NULL,
    benefit text NOT NULL,
    gwan_code text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    join_type text DEFAULT 'NONE'::text NOT NULL,
    max_joins integer,
    landing_url text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_join_check CHECK ((join_type = ANY (ARRAY['NONE'::text, 'CLICK'::text, 'APPLY'::text]))),
    CONSTRAINT events_max_check CHECK (((max_joins IS NULL) OR (max_joins > 0))),
    CONSTRAINT events_period_check CHECK ((ends_at > starts_at)),
    CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ENDED'::text, 'CANCELED'::text])))
);

CREATE TABLE public.faqs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    gwan_code text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.favorites (
    account_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT favorites_target_type_check CHECK ((target_type = ANY (ARRAY['LISTING'::text, 'REQUEST'::text])))
);

CREATE TABLE public.fee_agreements (
    id bigint NOT NULL,
    deal_id uuid NOT NULL,
    version integer NOT NULL,
    proposed_by uuid NOT NULL,
    amount numeric(14,0) NOT NULL,
    state text NOT NULL,
    agreed_by_buyer_at timestamp with time zone,
    agreed_by_seller_at timestamp with time zone,
    reason_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ip inet,
    CONSTRAINT fee_agreements_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT fee_agreements_check CHECK (((version = 1) OR (reason_code IS NOT NULL))),
    CONSTRAINT fee_agreements_state_check CHECK ((state = ANY (ARRAY['PROPOSED'::text, 'AGREED'::text, 'LOCKED'::text, 'SUPERSEDED'::text])))
);

CREATE SEQUENCE public.fee_agreements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.fee_agreements_id_seq OWNED BY public.fee_agreements.id;

CREATE TABLE public.fee_guarantees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid,
    business_id uuid NOT NULL,
    kind text NOT NULL,
    amount numeric NOT NULL,
    evidence_no text NOT NULL,
    evidence_key text,
    custodian text,
    verified_at timestamp with time zone,
    verified_by uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fee_guarantees_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT fee_guarantees_kind_check CHECK ((kind = ANY (ARRAY['GUARANTEED'::text, 'ESCROWED'::text])))
);

CREATE TABLE public.fee_guidelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gwan_code text NOT NULL,
    category_id uuid,
    guide_rate numeric(5,2),
    guide_note text,
    is_display_only boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fee_guidelines_is_display_only_check CHECK (is_display_only)
);

CREATE TABLE public.footer_links (
    id integer NOT NULL,
    section text NOT NULL,
    label text NOT NULL,
    target_type text NOT NULL,
    target_ref text,
    tip text,
    blocked_by text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT footer_links_section_check CHECK ((section = ANY (ARRAY['LEGAL'::text, 'SUPPORT'::text, 'GUIDE'::text]))),
    CONSTRAINT footer_links_target_type_check CHECK ((target_type = ANY (ARRAY['TERM'::text, 'SCREEN'::text, 'URL'::text, 'NONE'::text])))
);

CREATE SEQUENCE public.footer_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.footer_links_id_seq OWNED BY public.footer_links.id;

CREATE TABLE public.gwan_form_copy (
    gwan_code text NOT NULL,
    role text NOT NULL,
    subject text NOT NULL,
    title_hint text NOT NULL,
    body_hint text NOT NULL,
    notice text,
    CONSTRAINT gwan_form_copy_role_check CHECK ((role = ANY (ARRAY['OFFER'::text, 'REQUEST'::text])))
);

CREATE TABLE public.gwans (
    code text NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    opened_at timestamp with time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    parent_code text,
    is_primary boolean DEFAULT false NOT NULL,
    is_hub boolean DEFAULT false NOT NULL,
    sale_mode text DEFAULT 'BROKER'::text NOT NULL,
    CONSTRAINT gwans_code_check CHECK ((code ~ '^[A-Z]{3,4}$'::text)),
    CONSTRAINT gwans_sale_mode_check CHECK ((sale_mode = ANY (ARRAY['BROKER'::text, 'DIRECT'::text])))
);

CREATE TABLE public.hlt_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    label text,
    receiver text NOT NULL,
    phone text NOT NULL,
    zipcode text NOT NULL,
    addr1 text NOT NULL,
    addr2 text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.hlt_cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    product_id uuid NOT NULL,
    qty integer NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hlt_cart_qty_check CHECK (((qty > 0) AND (qty <= 99)))
);

CREATE TABLE public.hlt_carts (
    account_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.hlt_commission_changes (
    id bigint NOT NULL,
    scope text NOT NULL,
    target text NOT NULL,
    before_rate numeric(5,2),
    after_rate numeric(5,2) NOT NULL,
    reason text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hlt_chg_scope_check CHECK ((scope = ANY (ARRAY['CATEGORY'::text, 'SELLER'::text])))
);

CREATE SEQUENCE public.hlt_commission_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.hlt_commission_changes_id_seq OWNED BY public.hlt_commission_changes.id;

CREATE TABLE public.hlt_commission_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_code text NOT NULL,
    rate numeric(5,2) NOT NULL,
    note text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    referral_pct numeric(5,2) DEFAULT 0 NOT NULL,
    CONSTRAINT hlt_rate_check CHECK (((rate >= (0)::numeric) AND (rate <= (50)::numeric))),
    CONSTRAINT hlt_rate_range_check CHECK (((rate >= (0)::numeric) AND (rate <= (50)::numeric))),
    CONSTRAINT hlt_referral_pct_check CHECK (((referral_pct >= (0)::numeric) AND (referral_pct <= rate)))
);

CREATE TABLE public.hlt_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    qty integer NOT NULL,
    unit_price bigint NOT NULL,
    amount bigint NOT NULL,
    withdrawal_code text NOT NULL,
    commission_rate numeric(5,2),
    commission_amount bigint,
    CONSTRAINT hlt_items_amount_check CHECK ((amount = (unit_price * qty))),
    CONSTRAINT hlt_items_qty_check CHECK ((qty > 0))
);

CREATE SEQUENCE public.hlt_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.hlt_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no text NOT NULL,
    account_id uuid NOT NULL,
    address_id uuid,
    goods_amount bigint NOT NULL,
    ship_fee bigint DEFAULT 0 NOT NULL,
    total bigint NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    pay_method text,
    paid_at timestamp with time zone,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seller_id uuid,
    CONSTRAINT hlt_orders_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PAID'::text, 'PREPARING'::text, 'SHIPPED'::text, 'DELIVERED'::text, 'CANCELED'::text, 'RETURNED'::text]))),
    CONSTRAINT hlt_orders_total_check CHECK ((total = (goods_amount + ship_fee)))
);

CREATE TABLE public.hlt_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    method text NOT NULL,
    amount bigint NOT NULL,
    pg_tid text,
    state text DEFAULT 'READY'::text NOT NULL,
    approved_at timestamp with time zone,
    canceled_at timestamp with time zone,
    fail_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hlt_pay_amount_check CHECK ((amount > 0)),
    CONSTRAINT hlt_pay_method_check CHECK ((method = ANY (ARRAY['CARD'::text, 'TRANSFER'::text, 'VBANK'::text]))),
    CONSTRAINT hlt_pay_state_check CHECK ((state = ANY (ARRAY['READY'::text, 'PAID'::text, 'FAILED'::text, 'CANCELED'::text])))
);

CREATE TABLE public.hlt_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    category_id uuid,
    price bigint NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    review_no text,
    withdrawal_code text DEFAULT 'FOOD_SEALED'::text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    seller_id uuid,
    CONSTRAINT hlt_products_price_check CHECK ((price > 0)),
    CONSTRAINT hlt_products_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ON_SALE'::text, 'SOLD_OUT'::text, 'STOPPED'::text]))),
    CONSTRAINT hlt_products_stock_check CHECK ((stock >= 0))
);

CREATE TABLE public.hlt_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    kind text NOT NULL,
    reason text NOT NULL,
    detail text,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decide_note text,
    refund_amount bigint,
    refunded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hlt_returns_kind_check CHECK ((kind = ANY (ARRAY['CANCEL'::text, 'RETURN'::text, 'EXCHANGE'::text]))),
    CONSTRAINT hlt_returns_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'REFUNDED'::text])))
);

CREATE TABLE public.hlt_seller_licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    kind text NOT NULL,
    license_no text NOT NULL,
    issued_at date,
    expires_at date,
    file_note text,
    verified_by uuid,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hlt_license_kind_check CHECK ((kind = ANY (ARRAY['BIZ_REG'::text, 'ECOM_REG'::text, 'FOOD_SALE'::text, 'HEALTH_FUNC'::text, 'MED_DEVICE'::text])))
);

CREATE TABLE public.hlt_sellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    account_id uuid,
    biz_reg_no text,
    ceo_name text,
    ecom_reg_no text,
    cs_tel text,
    return_addr text,
    submerchant_id text,
    commission_rate numeric(5,2),
    status text DEFAULT 'PENDING'::text NOT NULL,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    addr text,
    CONSTRAINT hlt_sellers_biz_check CHECK (((biz_reg_no IS NULL) OR (biz_reg_no ~ '^[0-9]{3}-[0-9]{2}-[0-9]{5}$'::text))),
    CONSTRAINT hlt_sellers_rate_check CHECK (((commission_rate IS NULL) OR ((commission_rate >= (0)::numeric) AND (commission_rate <= (50)::numeric)))),
    CONSTRAINT hlt_sellers_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'PAUSED'::text, 'BLOCKED'::text]))),
    CONSTRAINT hlt_sellers_type_check CHECK ((type = ANY (ARRAY['DIRECT'::text, 'BRAND'::text, 'TENANT'::text])))
);

CREATE TABLE public.hlt_settlement_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    settlement_id uuid NOT NULL,
    order_id uuid NOT NULL,
    goods_amount bigint NOT NULL,
    commission bigint NOT NULL,
    net_amount bigint NOT NULL,
    kind text DEFAULT 'SALE'::text NOT NULL,
    CONSTRAINT hlt_stl_item_kind_check CHECK ((kind = ANY (ARRAY['SALE'::text, 'REFUND'::text])))
);

CREATE TABLE public.hlt_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    period_from date NOT NULL,
    period_to date NOT NULL,
    gross_amount bigint DEFAULT 0 NOT NULL,
    commission bigint DEFAULT 0 NOT NULL,
    refund_amount bigint DEFAULT 0 NOT NULL,
    carried_in bigint DEFAULT 0 NOT NULL,
    net_amount bigint DEFAULT 0 NOT NULL,
    carried_out bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    confirmed_at timestamp with time zone,
    paid_at timestamp with time zone,
    paid_by uuid,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hlt_settle_week_check CHECK (((period_to - period_from) = 7)),
    CONSTRAINT hlt_stl_period_check CHECK ((period_to > period_from)),
    CONSTRAINT hlt_stl_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'CONFIRMED'::text, 'PAID'::text, 'CARRIED'::text])))
);

CREATE TABLE public.hlt_shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    carrier text,
    tracking_no text,
    state text DEFAULT 'READY'::text NOT NULL,
    happened_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    CONSTRAINT hlt_ship_state_check CHECK ((state = ANY (ARRAY['READY'::text, 'PICKED'::text, 'IN_TRANSIT'::text, 'DELIVERED'::text, 'FAILED'::text])))
);

CREATE TABLE public.idempotency_records (
    key text NOT NULL,
    response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.identity_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    provider text NOT NULL,
    result text NOT NULL,
    ci_hash text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    raw jsonb,
    CONSTRAINT identity_verifications_provider_check CHECK ((provider = ANY (ARRAY['PASS'::text, 'NTS'::text, 'BANK_1WON'::text, 'KAKAO'::text]))),
    CONSTRAINT identity_verifications_result_check CHECK ((result = ANY (ARRAY['SUCCESS'::text, 'FAIL'::text, 'PENDING'::text])))
);

CREATE TABLE public.ingredients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    aliases text[],
    is_excipient boolean DEFAULT false NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid,
    email public.citext,
    category text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    answer text,
    answered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inquiries_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'ANSWERED'::text, 'CLOSED'::text])))
);

CREATE TABLE public.integrations (
    code text NOT NULL,
    name text NOT NULL,
    purpose text NOT NULL,
    provider text,
    status text DEFAULT 'NOT_STARTED'::text NOT NULL,
    requires_ip boolean DEFAULT true NOT NULL,
    egress_ip text,
    ip_requested_at timestamp with time zone,
    ip_approved_at timestamp with time zone,
    secret_key_name text,
    secret_registered boolean DEFAULT false NOT NULL,
    lead_time_weeks integer,
    blocks_open boolean DEFAULT false NOT NULL,
    memo text,
    sort_order integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT integrations_status_check CHECK ((status = ANY (ARRAY['NOT_STARTED'::text, 'CONTRACT'::text, 'IP_PENDING'::text, 'TESTING'::text, 'LIVE'::text, 'FAILED'::text])))
);

CREATE TABLE public.introducer_profiles (
    account_id uuid NOT NULL,
    headline text,
    regions text[] DEFAULT '{}'::text[] NOT NULL,
    categories text[] DEFAULT '{}'::text[] NOT NULL,
    target_types text[] DEFAULT '{}'::text[] NOT NULL,
    notify_from time without time zone,
    notify_to time without time zone,
    grade text DEFAULT 'SEED'::text NOT NULL,
    is_founding boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT introducer_profiles_grade_check CHECK ((grade = ANY (ARRAY['SEED'::text, 'VERIFIED'::text, 'EXPERT'::text, 'TOP'::text, 'REGION_PARTNER'::text])))
);

CREATE TABLE public.introducer_referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inviter_id uuid NOT NULL,
    invitee_id uuid NOT NULL,
    rewarded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT introducer_referrals_check CHECK ((inviter_id <> invitee_id))
);

CREATE TABLE public.introducer_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    introducer_id uuid NOT NULL,
    answer text NOT NULL,
    memo text,
    responded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT introducer_responses_answer_check CHECK ((answer = ANY (ARRAY['KNOW'::text, 'CHECKING'::text, 'DONT_KNOW'::text, 'NOT_MY_FIELD'::text])))
);

CREATE TABLE public.introduction_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invite_id uuid NOT NULL,
    request_id uuid NOT NULL,
    introducer_id uuid NOT NULL,
    requester_id uuid NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    is_valid boolean,
    validated_at timestamp with time zone,
    rating integer,
    reported boolean DEFAULT false NOT NULL,
    CONSTRAINT introduction_connections_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

CREATE TABLE public.introduction_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    introducer_id uuid NOT NULL,
    invitee_label text NOT NULL,
    token_hash text NOT NULL,
    state text DEFAULT 'SENT'::text NOT NULL,
    consented_at timestamp with time zone,
    consented_by uuid,
    declined_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT introduction_invites_state_check CHECK ((state = ANY (ARRAY['SENT'::text, 'VIEWED'::text, 'CONSENTED'::text, 'DECLINED'::text, 'EXPIRED'::text])))
);

CREATE TABLE public.invite_deliveries (
    id bigint NOT NULL,
    invite_id uuid NOT NULL,
    channel text NOT NULL,
    contact_enc bytea,
    contact_hash text,
    state text DEFAULT 'QUEUED'::text NOT NULL,
    detail text,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    purged_at timestamp with time zone,
    CONSTRAINT invite_deliveries_channel_check CHECK ((channel = ANY (ARRAY['SELF'::text, 'SMS'::text, 'ALIMTALK'::text, 'EMAIL'::text]))),
    CONSTRAINT invite_deliveries_state_check CHECK ((state = ANY (ARRAY['QUEUED'::text, 'SENT'::text, 'FAILED'::text, 'SKIPPED'::text, 'PURGED'::text])))
);

CREATE SEQUENCE public.invite_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.invite_deliveries_id_seq OWNED BY public.invite_deliveries.id;

CREATE TABLE public.item_types (
    code text NOT NULL,
    name text NOT NULL,
    description text,
    requires_business boolean DEFAULT false NOT NULL,
    connect_mode text DEFAULT 'CONSENT'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT item_types_connect_mode_check CHECK ((connect_mode = ANY (ARRAY['AFFILIATE'::text, 'CONSENT'::text])))
);

CREATE TABLE public.job_runs (
    id bigint NOT NULL,
    job text NOT NULL,
    slot text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    ok boolean,
    affected integer,
    detail text
);

CREATE SEQUENCE public.job_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.job_runs_id_seq OWNED BY public.job_runs.id;

CREATE TABLE public.job_schedules (
    job text NOT NULL,
    every_min integer NOT NULL,
    at_hour integer,
    at_minute integer,
    at_dow integer,
    is_active boolean DEFAULT true NOT NULL,
    description text,
    CONSTRAINT job_schedules_at_dow_check CHECK (((at_dow >= 1) AND (at_dow <= 7))),
    CONSTRAINT job_schedules_at_hour_check CHECK (((at_hour >= 0) AND (at_hour <= 23))),
    CONSTRAINT job_schedules_at_minute_check CHECK (((at_minute >= 0) AND (at_minute <= 59))),
    CONSTRAINT job_schedules_every_min_check CHECK ((every_min > 0))
);

CREATE TABLE public.lead_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    viewed_at timestamp with time zone,
    delivered_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lead_fee_changes (
    id bigint NOT NULL,
    category_id uuid NOT NULL,
    old_fee numeric,
    new_fee numeric NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.lead_fee_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.lead_fee_changes_id_seq OWNED BY public.lead_fee_changes.id;

CREATE TABLE public.lead_fees (
    id bigint NOT NULL,
    delivery_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    amount numeric NOT NULL,
    state text DEFAULT 'PENDING'::text NOT NULL,
    billed_at timestamp with time zone,
    voided_at timestamp with time zone,
    void_rule text,
    incurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lead_fees_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT lead_fees_state_check CHECK ((state = ANY (ARRAY['PENDING'::text, 'BILLED'::text, 'VOIDED'::text])))
);

CREATE SEQUENCE public.lead_fees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.lead_fees_id_seq OWNED BY public.lead_fees.id;

CREATE TABLE public.lead_grade_rates (
    grade text NOT NULL,
    rate numeric NOT NULL,
    note text,
    gwan_code text,
    rank integer NOT NULL,
    CONSTRAINT lead_grade_rates_grade_check CHECK ((grade = ANY (ARRAY['S'::text, 'A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'F'::text, 'G'::text]))),
    CONSTRAINT lead_grade_rates_rate_check CHECK (((rate > (0)::numeric) AND (rate <= (1)::numeric)))
);

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid,
    category_id uuid,
    sido text,
    sigungu text,
    summary text NOT NULL,
    contact_enc bytea,
    is_urgent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.listing_badges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    badge_type text NOT NULL,
    status text DEFAULT 'REQUESTED'::text NOT NULL,
    urgent_reason text,
    valid_until timestamp with time zone,
    evidence jsonb,
    requested_by uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    reject_reason_code text,
    reject_memo text,
    CONSTRAINT listing_badges_badge_type_check CHECK ((badge_type = ANY (ARRAY['URGENT'::text, 'VERIFIED_DOC'::text]))),
    CONSTRAINT listing_badges_check CHECK (((status <> 'REJECTED'::text) OR (reject_reason_code IS NOT NULL))),
    CONSTRAINT listing_badges_check1 CHECK (((badge_type <> 'URGENT'::text) OR ((urgent_reason IS NOT NULL) AND (valid_until IS NOT NULL)))),
    CONSTRAINT listing_badges_status_check CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'IN_REVIEW'::text, 'GRANTED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'REVOKED'::text])))
);

CREATE TABLE public.listing_checklist (
    code text NOT NULL,
    label text NOT NULL,
    target_type text NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    check_sql text NOT NULL,
    fail_message text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    gwan_code text,
    CONSTRAINT listing_checklist_target_type_check CHECK ((target_type = ANY (ARRAY['LISTING'::text, 'REQUEST'::text, 'SERVICE'::text])))
);

CREATE TABLE public.listing_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    s3_key text NOT NULL,
    media_type text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT listing_media_media_type_check CHECK ((media_type = ANY (ARRAY['IMAGE'::text, 'DOCUMENT'::text, 'VIDEO'::text])))
);

CREATE TABLE public.listing_regions (
    listing_id uuid NOT NULL,
    region_code text NOT NULL
);

CREATE TABLE public.listing_versions (
    id bigint NOT NULL,
    listing_id uuid NOT NULL,
    version integer NOT NULL,
    snapshot jsonb NOT NULL,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.listing_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.listing_versions_id_seq OWNED BY public.listing_versions.id;

CREATE TABLE public.listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gwan_code text NOT NULL,
    category_id uuid NOT NULL,
    owner_account_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    grade_code text DEFAULT 'G3'::text NOT NULL,
    desired_fee numeric(14,0),
    fee_bearer text,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_priority_exposed boolean DEFAULT false NOT NULL,
    priority_label text,
    badge_urgent_until timestamp with time zone,
    badge_verified_at timestamp with time zone,
    item_type text,
    review_no text,
    review_checked_at timestamp with time zone,
    CONSTRAINT listings_check CHECK (((NOT is_priority_exposed) OR (priority_label IS NOT NULL))),
    CONSTRAINT listings_desired_fee_check CHECK (((desired_fee IS NULL) OR (desired_fee >= (0)::numeric))),
    CONSTRAINT listings_fee_bearer_check CHECK ((fee_bearer = ANY (ARRAY['BUYER'::text, 'SELLER'::text, 'NEGOTIABLE'::text]))),
    CONSTRAINT listings_grade_code_check CHECK ((grade_code = ANY (ARRAY['G1'::text, 'G2'::text, 'G3'::text]))),
    CONSTRAINT listings_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'IN_REVIEW'::text, 'PUBLISHED'::text, 'REJECTED'::text, 'SUSPENDED'::text, 'ARCHIVED'::text])))
);

CREATE TABLE public.main_copy (
    slot text NOT NULL,
    text text NOT NULL,
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.main_sections (
    code text NOT NULL,
    name text NOT NULL,
    sort_order integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.member_ad_profiles (
    account_id uuid NOT NULL,
    segment_code text NOT NULL,
    answers jsonb NOT NULL,
    scores jsonb NOT NULL,
    consented_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    registered_at timestamp with time zone,
    source text DEFAULT 'MEMBER'::text NOT NULL,
    CONSTRAINT member_ad_profiles_source_check CHECK ((source = ANY (ARRAY['MEMBER'::text, 'GUEST_MERGED'::text])))
);

CREATE TABLE public.messages (
    id bigint NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    attachment_key text,
    masked boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;

CREATE TABLE public.notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gwan_code text,
    title text NOT NULL,
    body text NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notification_deliveries (
    id bigint NOT NULL,
    notification_id bigint,
    channel text NOT NULL,
    provider text,
    provider_msg_id text,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    idempotency_key text,
    sent_at timestamp with time zone,
    failed_reason text,
    CONSTRAINT notification_deliveries_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'SENT'::text, 'DELIVERED'::text, 'FAILED'::text])))
);

CREATE SEQUENCE public.notification_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.notification_deliveries_id_seq OWNED BY public.notification_deliveries.id;

CREATE TABLE public.notification_event_policies (
    event_code text NOT NULL,
    name text NOT NULL,
    optout_allowed boolean NOT NULL,
    quiet_hours_exempt boolean DEFAULT false NOT NULL,
    legal_basis text
);

CREATE TABLE public.notification_preferences (
    account_id uuid NOT NULL,
    event_code text NOT NULL,
    channel text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notification_templates (
    code text NOT NULL,
    channel text NOT NULL,
    title text,
    body text NOT NULL,
    variables jsonb,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT notification_templates_channel_check CHECK ((channel = ANY (ARRAY['INAPP'::text, 'EMAIL'::text, 'SMS'::text, 'ALIMTALK'::text, 'PUSH'::text])))
);

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    event_code text NOT NULL,
    template_code text,
    title text,
    body text NOT NULL,
    link_url text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;

CREATE TABLE public.ops_alerts (
    id bigint NOT NULL,
    alert_code text NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    detail jsonb,
    raised_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    CONSTRAINT ops_alerts_severity_check CHECK ((severity = ANY (ARRAY['INFO'::text, 'WARN'::text, 'CRITICAL'::text])))
);

CREATE SEQUENCE public.ops_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ops_alerts_id_seq OWNED BY public.ops_alerts.id;

CREATE TABLE public.owner_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    applicant_id uuid NOT NULL,
    doc_key text,
    issued_on date,
    address_match boolean,
    state text DEFAULT 'SUBMITTED'::text NOT NULL,
    has_encumbrance boolean,
    reject_code text,
    reject_reason text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT owner_verifications_state_check CHECK ((state = ANY (ARRAY['SUBMITTED'::text, 'PENDING'::text, 'SUPPLEMENT'::text, 'VERIFIED'::text, 'REJECTED'::text])))
);

CREATE TABLE public.partner_regions (
    partner_id uuid NOT NULL,
    sido text NOT NULL,
    sigungu text NOT NULL
);

CREATE TABLE public.partner_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    category_id uuid,
    title text NOT NULL,
    body text,
    status text DEFAULT 'IN_REVIEW'::text NOT NULL,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_services_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'IN_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUSPENDED'::text])))
);

CREATE TABLE public.partners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    grade text DEFAULT 'BRONZE'::text NOT NULL,
    status text DEFAULT 'APPLIED'::text NOT NULL,
    unpaid_cap numeric DEFAULT 300000 NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_at timestamp with time zone,
    approved_by uuid,
    suspended_reason text,
    CONSTRAINT partners_grade_check CHECK ((grade = ANY (ARRAY['BRONZE'::text, 'SILVER'::text, 'GOLD'::text, 'PLATINUM'::text]))),
    CONSTRAINT partners_status_check CHECK ((status = ANY (ARRAY['APPLIED'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'WITHDRAWN'::text]))),
    CONSTRAINT partners_unpaid_cap_check CHECK ((unpaid_cap >= (0)::numeric))
);

CREATE TABLE public.payout_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    bank_name text NOT NULL,
    holder_name text NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    verify_code text,
    verify_sent_at timestamp with time zone,
    verified_at timestamp with time zone,
    verify_tries integer DEFAULT 0 NOT NULL,
    is_stub boolean DEFAULT false NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_enc bytea,
    account_last4 text,
    bank_enc bytea,
    CONSTRAINT payout_enc_required CHECK ((account_enc IS NOT NULL)),
    CONSTRAINT payout_tries_check CHECK ((verify_tries <= 5))
);

CREATE TABLE public.pending_decisions (
    code text NOT NULL,
    title text NOT NULL,
    depends_on text NOT NULL,
    risk text NOT NULL,
    blocks_open boolean DEFAULT false NOT NULL,
    note text NOT NULL,
    CONSTRAINT pending_decisions_risk_check CHECK ((risk = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text])))
);

CREATE TABLE public.point_ledger (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    rule_code text NOT NULL,
    points integer NOT NULL,
    redeemable boolean DEFAULT false NOT NULL,
    connection_id uuid,
    memo text,
    earned_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.point_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.point_ledger_id_seq OWNED BY public.point_ledger.id;

CREATE TABLE public.point_rules (
    code text NOT NULL,
    name text NOT NULL,
    points integer NOT NULL,
    needs_valid boolean DEFAULT true NOT NULL,
    monthly_cap integer,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT point_rules_points_check CHECK ((points > 0))
);

CREATE TABLE public.profile_options (
    question_code text NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    weights jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.profile_questions (
    code text NOT NULL,
    question text NOT NULL,
    is_multi boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.property_listings (
    listing_id uuid NOT NULL,
    broker_reg_no text,
    address_sido text,
    address_sigungu text,
    area_m2 numeric,
    price numeric,
    deal_type text,
    verified_at timestamp with time zone,
    verified_by uuid,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_listings_area_m2_check CHECK (((area_m2 IS NULL) OR (area_m2 > (0)::numeric))),
    CONSTRAINT property_listings_deal_type_check CHECK ((deal_type = ANY (ARRAY['SALE'::text, 'JEONSE'::text, 'MONTHLY'::text]))),
    CONSTRAINT property_listings_price_check CHECK (((price IS NULL) OR (price >= (0)::numeric)))
);

CREATE TABLE public.public_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    asker_id uuid NOT NULL,
    question text NOT NULL,
    answer text,
    answered_at timestamp with time zone,
    is_hidden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.qualification_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    category_code text NOT NULL,
    doc_no text,
    lookup_done boolean DEFAULT false NOT NULL,
    lookup_by uuid,
    lookup_at timestamp with time zone,
    state text DEFAULT 'PENDING'::text NOT NULL,
    reject_reason text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT qualification_reviews_state_check CHECK ((state = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])))
);

CREATE TABLE public.qualification_rules (
    category_code text NOT NULL,
    category_name text NOT NULL,
    required_doc text NOT NULL,
    legal_basis text NOT NULL,
    needs_lookup boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE public.recommend_weights (
    code text NOT NULL,
    name text NOT NULL,
    weight integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT recommend_weights_weight_check CHECK (((weight >= 0) AND (weight <= 100)))
);

CREATE TABLE public.referral_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    owner_account_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    is_extra boolean DEFAULT false NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    memo text
);

CREATE TABLE public.regions (
    code text NOT NULL,
    sido text NOT NULL,
    sigungu text,
    eupmyeondong text,
    parent_code text,
    is_active boolean DEFAULT true NOT NULL
);

CREATE TABLE public.report_reasons (
    code text NOT NULL,
    label text NOT NULL,
    severity text NOT NULL,
    auto_queue_at integer DEFAULT 3 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    gwan_code text,
    CONSTRAINT report_reasons_severity_check CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text])))
);

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reason_code text NOT NULL,
    detail text,
    reporter_id uuid,
    state text DEFAULT 'OPEN'::text NOT NULL,
    resolution text,
    handled_by uuid,
    handled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reports_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'QUEUED'::text, 'UPHELD'::text, 'DISMISSED'::text]))),
    CONSTRAINT reports_target_type_check CHECK ((target_type = ANY (ARRAY['LISTING'::text, 'REQUEST'::text, 'SERVICE'::text, 'PROFILE'::text])))
);

CREATE TABLE public.request_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    proposer_account_id uuid NOT NULL,
    listing_id uuid,
    message text,
    status text DEFAULT 'PROPOSED'::text NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT request_proposals_status_check CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'WITHDRAWN'::text])))
);

CREATE TABLE public.request_views (
    id bigint NOT NULL,
    request_id uuid NOT NULL,
    viewer_account_id uuid NOT NULL,
    subscription_id uuid,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.request_views_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.request_views_id_seq OWNED BY public.request_views.id;

CREATE TABLE public.requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gwan_code text NOT NULL,
    category_id uuid,
    owner_account_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    budget_min numeric(14,0),
    budget_max numeric(14,0),
    offered_fee numeric(14,0),
    status text DEFAULT 'DRAFT'::text NOT NULL,
    closes_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    item_type text,
    CONSTRAINT requests_check CHECK (((budget_max IS NULL) OR (budget_min IS NULL) OR (budget_max >= budget_min))),
    CONSTRAINT requests_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'IN_REVIEW'::text, 'PUBLISHED'::text, 'REJECTED'::text, 'CLOSED'::text, 'ARCHIVED'::text])))
);

CREATE TABLE public.restrict_vocab (
    code text NOT NULL,
    term text NOT NULL,
    memo text
);

CREATE TABLE public.restricted_industries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    legal_basis text NOT NULL,
    gwan_code text NOT NULL,
    mode text DEFAULT 'BLOCK'::text NOT NULL,
    gate_requirement text,
    is_active boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    block_message text DEFAULT '해당 업종은 관련 법령에 따라 등록이 제한됩니다. 자세한 내용은 고객센터로 문의해 주십시오.'::text NOT NULL,
    CONSTRAINT restricted_industries_mode_check CHECK ((mode = ANY (ARRAY['BLOCK'::text, 'GATED'::text, 'ALLOW'::text, 'AD_ONLY'::text])))
);

CREATE TABLE public.review_events (
    id bigint NOT NULL,
    review_item_id uuid NOT NULL,
    event text NOT NULL,
    actor_id uuid,
    reason_code text,
    memo text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_events_event_check CHECK ((event = ANY (ARRAY['SUBMITTED'::text, 'ASSIGNED'::text, 'APPROVED'::text, 'REJECTED'::text, 'RESUBMITTED'::text])))
);

CREATE SEQUENCE public.review_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.review_events_id_seq OWNED BY public.review_events.id;

CREATE TABLE public.review_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    gwan_code text,
    submitted_by uuid NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    sla_due_at timestamp with time zone NOT NULL,
    assignee_id uuid,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    decision_by uuid,
    decided_at timestamp with time zone,
    reject_reason_code text,
    reject_memo text,
    decision_mode text DEFAULT 'MANUAL'::text NOT NULL,
    manual_reasons text[],
    audit_sampled boolean DEFAULT false NOT NULL,
    CONSTRAINT review_items_check CHECK (((status <> 'REJECTED'::text) OR (reject_reason_code IS NOT NULL))),
    CONSTRAINT review_items_decision_mode_check CHECK ((decision_mode = ANY (ARRAY['MANUAL'::text, 'AUTO'::text]))),
    CONSTRAINT review_items_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'IN_PROGRESS'::text, 'APPROVED'::text, 'REJECTED'::text]))),
    CONSTRAINT review_items_target_type_check CHECK ((target_type = ANY (ARRAY['LISTING'::text, 'REQUEST'::text, 'LEAD_SERVICE'::text, 'MEDICAL'::text, 'BUSINESS'::text, 'CATEGORY'::text, 'LISTING_BADGE'::text])))
);

CREATE TABLE public.review_reason_codes (
    code text NOT NULL,
    label text NOT NULL,
    category text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.risk_actions (
    id bigint NOT NULL,
    alert_id bigint NOT NULL,
    action text NOT NULL,
    memo text,
    acted_by uuid,
    acted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT risk_actions_action_check CHECK ((action = ANY (ARRAY['NOTE'::text, 'CONTACT'::text, 'SUSPEND_LISTING'::text, 'SUSPEND_ACCOUNT'::text, 'REJECT'::text, 'RESTORE'::text, 'ESCALATE'::text])))
);

CREATE SEQUENCE public.risk_actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.risk_actions_id_seq OWNED BY public.risk_actions.id;

CREATE TABLE public.risk_alerts (
    id bigint NOT NULL,
    rule_code text NOT NULL,
    severity text NOT NULL,
    subject text NOT NULL,
    detail text NOT NULL,
    reason text,
    action text,
    state text DEFAULT 'OPEN'::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_by uuid,
    CONSTRAINT risk_alerts_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'REVIEWING'::text, 'CLOSED'::text, 'FALSE_POSITIVE'::text])))
);

CREATE SEQUENCE public.risk_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.risk_alerts_id_seq OWNED BY public.risk_alerts.id;

CREATE TABLE public.risk_rules (
    code text NOT NULL,
    name text NOT NULL,
    protects text NOT NULL,
    source text NOT NULL,
    false_positive text,
    severity text DEFAULT 'MEDIUM'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    detect_sql text,
    auto_detect boolean DEFAULT false NOT NULL,
    CONSTRAINT risk_rules_severity_check CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text])))
);

CREATE TABLE public.role_changes (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    role text NOT NULL,
    action text NOT NULL,
    reason text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_changes_action_check CHECK ((action = ANY (ARRAY['GRANT'::text, 'REVOKE'::text])))
);

CREATE SEQUENCE public.role_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.role_changes_id_seq OWNED BY public.role_changes.id;

CREATE TABLE public.safe_numbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    virtual_no text NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    code text,
    visitor_key text,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    released_at timestamp with time zone,
    CONSTRAINT safe_numbers_target_type_check CHECK ((target_type = ANY (ARRAY['LISTING'::text, 'REQUEST'::text])))
);

CREATE TABLE public.setting_placeholders (
    token text NOT NULL,
    memo text
);

CREATE TABLE public.settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    payee_account_id uuid NOT NULL,
    payee_business_id uuid NOT NULL,
    amount numeric(14,0) NOT NULL,
    status text DEFAULT 'REQUESTED'::text NOT NULL,
    held_by_dispute_id uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    reject_reason text,
    paid_marked_by uuid,
    paid_marked_at timestamp with time zone,
    CONSTRAINT settlements_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT settlements_status_check CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'PAID'::text, 'HELD'::text, 'REJECTED'::text])))
);

CREATE TABLE public.signup_types (
    code text NOT NULL,
    label text NOT NULL,
    sub text NOT NULL,
    needs_biz boolean DEFAULT false NOT NULL,
    needs_corp boolean DEFAULT false NOT NULL,
    sort_order integer NOT NULL
);

CREATE TABLE public.site_settings (
    key text NOT NULL,
    value text,
    scope text DEFAULT 'GLOBAL'::text NOT NULL,
    description text,
    is_required_for_open boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    value_pattern text,
    value_example text,
    min_length integer
);

CREATE TABLE public.subscription_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    amount numeric(14,0) NOT NULL,
    payment_id uuid,
    status text DEFAULT 'OPEN'::text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    billing_key_id uuid,
    attempt integer DEFAULT 1 NOT NULL,
    failure_reason text,
    paid_at timestamp with time zone,
    payment_key text,
    CONSTRAINT subscription_invoices_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PAID'::text, 'FAILED'::text, 'SKIPPED'::text, 'REFUNDED'::text])))
);

CREATE TABLE public.subscription_plans (
    code text NOT NULL,
    name text NOT NULL,
    monthly_price numeric(14,0) NOT NULL,
    included_codes integer NOT NULL,
    proposal_limit integer,
    extra_code_price numeric(14,0) DEFAULT 30000 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    request_views_per_month integer,
    listing_slots integer,
    exposure_weight numeric(3,2) DEFAULT 1.00 NOT NULL,
    priority_slot_count integer DEFAULT 0 NOT NULL,
    success_fee numeric DEFAULT 0 NOT NULL,
    CONSTRAINT subscription_plans_code_check CHECK ((code = ANY (ARRAY['BASIC'::text, 'STANDARD'::text, 'PRO'::text]))),
    CONSTRAINT subscription_plans_success_fee_check CHECK ((success_fee >= (0)::numeric))
);

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    plan_code text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    current_period_start timestamp with time zone NOT NULL,
    current_period_end timestamp with time zone NOT NULL,
    cancel_at timestamp with time zone,
    is_promo boolean DEFAULT false NOT NULL,
    codes_used_this_period integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    request_views_used integer DEFAULT 0 NOT NULL,
    promo_ends_at timestamp with time zone,
    promo_notified_at timestamp with time zone,
    refunded_at timestamp with time zone,
    refund_reason text,
    CONSTRAINT chk_promo_ends CHECK (((NOT is_promo) OR (promo_ends_at IS NOT NULL))),
    CONSTRAINT subscriptions_check CHECK ((current_period_end > current_period_start)),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PAST_DUE'::text, 'CANCELLED'::text, 'EXPIRED'::text])))
);

CREATE TABLE public.success_fees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    payer_account_id uuid NOT NULL,
    plan_code text NOT NULL,
    amount numeric NOT NULL,
    status text DEFAULT 'BILLED'::text NOT NULL,
    invoice_id uuid,
    waived_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT success_fees_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT success_fees_status_check CHECK ((status = ANY (ARRAY['BILLED'::text, 'PAID'::text, 'WAIVED'::text, 'CANCELLED'::text])))
);

CREATE TABLE public.term_agreements (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    term_code text NOT NULL,
    term_version text NOT NULL,
    agreed boolean NOT NULL,
    agreed_at timestamp with time zone DEFAULT now() NOT NULL,
    ip inet,
    user_agent text
);

CREATE SEQUENCE public.term_agreements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.term_agreements_id_seq OWNED BY public.term_agreements.id;

CREATE TABLE public.terms (
    code text NOT NULL,
    version text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    blocked_by text,
    display_order integer DEFAULT 0 NOT NULL,
    gwan_code text,
    CONSTRAINT terms_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'LEGAL_REVIEW'::text, 'PUBLISHED'::text, 'ARCHIVED'::text])))
);

CREATE TABLE public.trust_weights (
    code text NOT NULL,
    label text NOT NULL,
    weight numeric NOT NULL,
    note text
);

CREATE TABLE public.ui_messages (
    code text NOT NULL,
    message text NOT NULL,
    placement text NOT NULL,
    basis text,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.visitor_identities (
    id bigint NOT NULL,
    visitor_key text NOT NULL,
    account_id uuid NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'LOGIN'::text NOT NULL,
    CONSTRAINT visitor_identities_source_check CHECK ((source = ANY (ARRAY['LOGIN'::text, 'SIGNUP'::text, 'MERGE'::text])))
);

CREATE SEQUENCE public.visitor_identities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.visitor_identities_id_seq OWNED BY public.visitor_identities.id;

CREATE TABLE public.withdrawal_rules (
    code text NOT NULL,
    label text NOT NULL,
    days integer DEFAULT 7 NOT NULL,
    blocked_if text,
    law text,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT withdrawal_rules_days_check CHECK ((days >= 7))
);
