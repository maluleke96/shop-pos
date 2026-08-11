-- AUTO-GENERATED from live SQLite — Shop POS → Supabase Postgres
-- SAFE: CREATE IF NOT EXISTS only. No DROP / TRUNCATE.
-- Source: C:\Users\MALULEKE HAPPY\Downloads\ShopPOS\migration-backups\backup-20260811-155932\shop-pos.db
-- Generated: 2026-08-11T14:00:26.814Z

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table: archived_records
CREATE TABLE IF NOT EXISTS public."archived_records" (
  "id" bigint PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_id" bigint,
  "archived_data" text,
  "archived_at" text DEFAULT now(),
  "user_id" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."archived_records_id_seq";
ALTER TABLE public."archived_records" ALTER COLUMN "id" SET DEFAULT nextval('public.archived_records_id_seq');
SELECT setval('public.archived_records_id_seq', COALESCE((SELECT MAX("id") FROM public."archived_records"), 1));

-- Table: attendance_penalties
CREATE TABLE IF NOT EXISTS public."attendance_penalties" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "attendance_id" bigint,
  "work_date" text,
  "penalty_type" text NOT NULL,
  "amount" numeric NOT NULL,
  "reason" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_by" bigint,
  "created_by_name" text,
  "applied_payroll_id" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."attendance_penalties_id_seq";
ALTER TABLE public."attendance_penalties" ALTER COLUMN "id" SET DEFAULT nextval('public.attendance_penalties_id_seq');
SELECT setval('public.attendance_penalties_id_seq', COALESCE((SELECT MAX("id") FROM public."attendance_penalties"), 1));

-- Table: audit_log
CREATE TABLE IF NOT EXISTS public."audit_log" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint,
  "username" text,
  "action" text NOT NULL,
  "entity_type" text,
  "entity_id" bigint,
  "details" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."audit_log_id_seq";
ALTER TABLE public."audit_log" ALTER COLUMN "id" SET DEFAULT nextval('public.audit_log_id_seq');
SELECT setval('public.audit_log_id_seq', COALESCE((SELECT MAX("id") FROM public."audit_log"), 1));

-- Table: automation_rules
CREATE TABLE IF NOT EXISTS public."automation_rules" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "trigger_type" text NOT NULL,
  "condition_json" jsonb NOT NULL DEFAULT '{}',
  "action_json" jsonb NOT NULL DEFAULT '{}',
  "is_active" bigint DEFAULT 1,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."automation_rules_id_seq";
ALTER TABLE public."automation_rules" ALTER COLUMN "id" SET DEFAULT nextval('public.automation_rules_id_seq');
SELECT setval('public.automation_rules_id_seq', COALESCE((SELECT MAX("id") FROM public."automation_rules"), 1));

-- Table: bank_transactions
CREATE TABLE IF NOT EXISTS public."bank_transactions" (
  "id" bigint PRIMARY KEY,
  "txn_date" text NOT NULL,
  "txn_type" text NOT NULL,
  "description" text,
  "amount" numeric NOT NULL,
  "direction" text NOT NULL,
  "bank_reference" text,
  "reconciled" bigint DEFAULT 0,
  "reconciled_date" text,
  "created_by" bigint,
  "created_by_name" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."bank_transactions_id_seq";
ALTER TABLE public."bank_transactions" ALTER COLUMN "id" SET DEFAULT nextval('public.bank_transactions_id_seq');
SELECT setval('public.bank_transactions_id_seq', COALESCE((SELECT MAX("id") FROM public."bank_transactions"), 1));

-- Table: bookkeeping_settings
CREATE TABLE IF NOT EXISTS public."bookkeeping_settings" (
  "id" bigint PRIMARY KEY,
  "cash_opening_balance" numeric DEFAULT 0,
  "bank_opening_balance" numeric DEFAULT 0,
  "bank_name" text,
  "bank_account_number" text,
  "vat_rate" numeric DEFAULT 15,
  "vat_registered" bigint DEFAULT 0,
  "fiscal_year_start" text DEFAULT '03-01',
  "low_cash_threshold" numeric DEFAULT 500,
  "notification_settings" jsonb DEFAULT '{}',
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."bookkeeping_settings_id_seq";
ALTER TABLE public."bookkeeping_settings" ALTER COLUMN "id" SET DEFAULT nextval('public.bookkeeping_settings_id_seq');
SELECT setval('public.bookkeeping_settings_id_seq', COALESCE((SELECT MAX("id") FROM public."bookkeeping_settings"), 1));

-- Table: branches
CREATE TABLE IF NOT EXISTS public."branches" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "code" text,
  "address" text,
  "phone" text,
  "is_active" bigint DEFAULT 1,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."branches_id_seq";
ALTER TABLE public."branches" ALTER COLUMN "id" SET DEFAULT nextval('public.branches_id_seq');
SELECT setval('public.branches_id_seq', COALESCE((SELECT MAX("id") FROM public."branches"), 1));

-- Table: budgets
CREATE TABLE IF NOT EXISTS public."budgets" (
  "id" bigint PRIMARY KEY,
  "budget_month" text NOT NULL,
  "category" text NOT NULL,
  "department" text DEFAULT 'general',
  "amount" numeric NOT NULL,
  "notes" text,
  "created_by" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."budgets_id_seq";
ALTER TABLE public."budgets" ALTER COLUMN "id" SET DEFAULT nextval('public.budgets_id_seq');
SELECT setval('public.budgets_id_seq', COALESCE((SELECT MAX("id") FROM public."budgets"), 1));

-- Table: cash_drawer_log
CREATE TABLE IF NOT EXISTS public."cash_drawer_log" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint,
  "action" text NOT NULL,
  "amount" numeric DEFAULT 0,
  "reason" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."cash_drawer_log_id_seq";
ALTER TABLE public."cash_drawer_log" ALTER COLUMN "id" SET DEFAULT nextval('public.cash_drawer_log_id_seq');
SELECT setval('public.cash_drawer_log_id_seq', COALESCE((SELECT MAX("id") FROM public."cash_drawer_log"), 1));

-- Table: cash_drops
CREATE TABLE IF NOT EXISTS public."cash_drops" (
  "id" bigint PRIMARY KEY,
  "shift_id" bigint NOT NULL,
  "user_id" bigint,
  "user_name" text,
  "amount" numeric NOT NULL,
  "proof_path" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'pending',
  "confirmed_by" bigint,
  "confirmed_at" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."cash_drops_id_seq";
ALTER TABLE public."cash_drops" ALTER COLUMN "id" SET DEFAULT nextval('public.cash_drops_id_seq');
SELECT setval('public.cash_drops_id_seq', COALESCE((SELECT MAX("id") FROM public."cash_drops"), 1));

-- Table: cashout_penalties
CREATE TABLE IF NOT EXISTS public."cashout_penalties" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint,
  "employee_id" bigint,
  "shift_id" bigint,
  "work_date" text,
  "amount" numeric NOT NULL,
  "reason" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_by_name" text,
  "applied_payroll_id" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."cashout_penalties_id_seq";
ALTER TABLE public."cashout_penalties" ALTER COLUMN "id" SET DEFAULT nextval('public.cashout_penalties_id_seq');
SELECT setval('public.cashout_penalties_id_seq', COALESCE((SELECT MAX("id") FROM public."cashout_penalties"), 1));

-- Table: cashup_sessions
CREATE TABLE IF NOT EXISTS public."cashup_sessions" (
  "id" bigint PRIMARY KEY,
  "shift_id" bigint,
  "user_id" bigint,
  "branch_id" bigint DEFAULT 1,
  "opening_cash" numeric DEFAULT 0,
  "cash_sales" numeric DEFAULT 0,
  "card_sales" numeric DEFAULT 0,
  "eft_sales" numeric DEFAULT 0,
  "mobile_sales" numeric DEFAULT 0,
  "expenses" numeric DEFAULT 0,
  "refunds" numeric DEFAULT 0,
  "expected_cash" numeric DEFAULT 0,
  "actual_cash" numeric DEFAULT 0,
  "difference" numeric DEFAULT 0,
  "manager_approved" bigint DEFAULT 0,
  "notes" text,
  "created_at" text DEFAULT now(),
  "approved_by" bigint,
  "approved_at" text,
  "approval_notes" text
);

CREATE SEQUENCE IF NOT EXISTS public."cashup_sessions_id_seq";
ALTER TABLE public."cashup_sessions" ALTER COLUMN "id" SET DEFAULT nextval('public.cashup_sessions_id_seq');
SELECT setval('public.cashup_sessions_id_seq', COALESCE((SELECT MAX("id") FROM public."cashup_sessions"), 1));

-- Table: categories
CREATE TABLE IF NOT EXISTS public."categories" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "color" text DEFAULT '#3b82f6',
  "sort_order" bigint DEFAULT 0,
  "is_active" bigint DEFAULT 1,
  "created_at" text DEFAULT now(),
  "image_path" text,
  "show_on_pos" bigint DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."categories_id_seq";
ALTER TABLE public."categories" ALTER COLUMN "id" SET DEFAULT nextval('public.categories_id_seq');
SELECT setval('public.categories_id_seq', COALESCE((SELECT MAX("id") FROM public."categories"), 1));

-- Table: closing_checklist_templates
CREATE TABLE IF NOT EXISTS public."closing_checklist_templates" (
  "id" bigint PRIMARY KEY,
  "task_name" text NOT NULL,
  "sort_order" bigint DEFAULT 0,
  "is_required" bigint DEFAULT 1,
  "is_active" bigint DEFAULT 1,
  "created_by" bigint,
  "assigned_employee_id" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."closing_checklist_templates_id_seq";
ALTER TABLE public."closing_checklist_templates" ALTER COLUMN "id" SET DEFAULT nextval('public.closing_checklist_templates_id_seq');
SELECT setval('public.closing_checklist_templates_id_seq', COALESCE((SELECT MAX("id") FROM public."closing_checklist_templates"), 1));

-- Table: combo_items
CREATE TABLE IF NOT EXISTS public."combo_items" (
  "id" bigint PRIMARY KEY,
  "combo_id" bigint NOT NULL,
  "product_id" bigint NOT NULL,
  "quantity" numeric NOT NULL DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."combo_items_id_seq";
ALTER TABLE public."combo_items" ALTER COLUMN "id" SET DEFAULT nextval('public.combo_items_id_seq');
SELECT setval('public.combo_items_id_seq', COALESCE((SELECT MAX("id") FROM public."combo_items"), 1));

-- Table: combo_sale_log
CREATE TABLE IF NOT EXISTS public."combo_sale_log" (
  "id" bigint PRIMARY KEY,
  "combo_id" bigint NOT NULL,
  "sale_id" bigint,
  "sale_item_id" bigint,
  "quantity" numeric DEFAULT 1,
  "unit_price" numeric DEFAULT 0,
  "total" numeric DEFAULT 0,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."combo_sale_log_id_seq";
ALTER TABLE public."combo_sale_log" ALTER COLUMN "id" SET DEFAULT nextval('public.combo_sale_log_id_seq');
SELECT setval('public.combo_sale_log_id_seq', COALESCE((SELECT MAX("id") FROM public."combo_sale_log"), 1));

-- Table: combos
CREATE TABLE IF NOT EXISTS public."combos" (
  "id" bigint PRIMARY KEY,
  "combo_code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "image_path" text,
  "category" text,
  "branch_id" bigint,
  "start_date" text,
  "end_date" text,
  "status" text NOT NULL DEFAULT 'draft',
  "pricing_type" text NOT NULL DEFAULT 'fixed',
  "normal_price" numeric DEFAULT 0,
  "discount_value" numeric DEFAULT 0,
  "final_price" numeric DEFAULT 0,
  "max_uses" bigint,
  "promo_type" text,
  "valid_time_start" text,
  "valid_time_end" text,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "approval_status" text DEFAULT 'approved',
  "submitted_by" bigint,
  "submitted_at" text,
  "approved_by" bigint,
  "approved_at" text,
  "rejection_notes" text
);

CREATE SEQUENCE IF NOT EXISTS public."combos_id_seq";
ALTER TABLE public."combos" ALTER COLUMN "id" SET DEFAULT nextval('public.combos_id_seq');
SELECT setval('public.combos_id_seq', COALESCE((SELECT MAX("id") FROM public."combos"), 1));

-- Table: company_rule_history
CREATE TABLE IF NOT EXISTS public."company_rule_history" (
  "id" bigint PRIMARY KEY,
  "rule_id" bigint NOT NULL,
  "action" text NOT NULL,
  "previous_json" jsonb,
  "new_json" jsonb,
  "user_id" bigint,
  "username" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."company_rule_history_id_seq";
ALTER TABLE public."company_rule_history" ALTER COLUMN "id" SET DEFAULT nextval('public.company_rule_history_id_seq');
SELECT setval('public.company_rule_history_id_seq', COALESCE((SELECT MAX("id") FROM public."company_rule_history"), 1));

-- Table: company_rules
CREATE TABLE IF NOT EXISTS public."company_rules" (
  "id" bigint PRIMARY KEY,
  "rule_number" text NOT NULL,
  "title" text NOT NULL,
  "category" text,
  "description" text,
  "effective_date" text,
  "version" bigint DEFAULT 1,
  "status" text NOT NULL DEFAULT 'active',
  "attachments_json" jsonb,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."company_rules_id_seq";
ALTER TABLE public."company_rules" ALTER COLUMN "id" SET DEFAULT nextval('public.company_rules_id_seq');
SELECT setval('public.company_rules_id_seq', COALESCE((SELECT MAX("id") FROM public."company_rules"), 1));

-- Table: compliance_certificates
CREATE TABLE IF NOT EXISTS public."compliance_certificates" (
  "id" bigint PRIMARY KEY,
  "cert_type" text NOT NULL,
  "file_path" text,
  "file_name" text,
  "expiry_date" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."compliance_certificates_id_seq";
ALTER TABLE public."compliance_certificates" ALTER COLUMN "id" SET DEFAULT nextval('public.compliance_certificates_id_seq');
SELECT setval('public.compliance_certificates_id_seq', COALESCE((SELECT MAX("id") FROM public."compliance_certificates"), 1));

-- Table: compliance_checklist_warnings
CREATE TABLE IF NOT EXISTS public."compliance_checklist_warnings" (
  "id" bigint PRIMARY KEY,
  "run_type" text NOT NULL,
  "run_date" text NOT NULL,
  "run_id" bigint,
  "employee_id" bigint,
  "manager_user_id" bigint,
  "manager_name" text,
  "warning_type" text NOT NULL DEFAULT 'not_submitted',
  "message" text,
  "whatsapp_url" text,
  "whatsapp_body" text,
  "acknowledged" bigint DEFAULT 0,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."compliance_checklist_warnings_id_seq";
ALTER TABLE public."compliance_checklist_warnings" ALTER COLUMN "id" SET DEFAULT nextval('public.compliance_checklist_warnings_id_seq');
SELECT setval('public.compliance_checklist_warnings_id_seq', COALESCE((SELECT MAX("id") FROM public."compliance_checklist_warnings"), 1));

-- Table: custom_field_values
CREATE TABLE IF NOT EXISTS public."custom_field_values" (
  "id" bigint PRIMARY KEY,
  "field_id" bigint NOT NULL,
  "entity_id" bigint NOT NULL,
  "value" text
);

CREATE SEQUENCE IF NOT EXISTS public."custom_field_values_id_seq";
ALTER TABLE public."custom_field_values" ALTER COLUMN "id" SET DEFAULT nextval('public.custom_field_values_id_seq');
SELECT setval('public.custom_field_values_id_seq', COALESCE((SELECT MAX("id") FROM public."custom_field_values"), 1));

-- Table: custom_fields
CREATE TABLE IF NOT EXISTS public."custom_fields" (
  "id" bigint PRIMARY KEY,
  "entity_type" text NOT NULL,
  "field_name" text NOT NULL,
  "field_label" text NOT NULL,
  "field_type" text DEFAULT 'text',
  "options_json" jsonb DEFAULT '[]',
  "is_required" bigint DEFAULT 0,
  "sort_order" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."custom_fields_id_seq";
ALTER TABLE public."custom_fields" ALTER COLUMN "id" SET DEFAULT nextval('public.custom_fields_id_seq');
SELECT setval('public.custom_fields_id_seq', COALESCE((SELECT MAX("id") FROM public."custom_fields"), 1));

-- Table: customer_credit_ledger
CREATE TABLE IF NOT EXISTS public."customer_credit_ledger" (
  "id" bigint PRIMARY KEY,
  "customer_id" bigint NOT NULL,
  "amount" numeric NOT NULL,
  "type" text NOT NULL,
  "balance_after" numeric NOT NULL,
  "sale_id" bigint,
  "notes" text,
  "user_id" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."customer_credit_ledger_id_seq";
ALTER TABLE public."customer_credit_ledger" ALTER COLUMN "id" SET DEFAULT nextval('public.customer_credit_ledger_id_seq');
SELECT setval('public.customer_credit_ledger_id_seq', COALESCE((SELECT MAX("id") FROM public."customer_credit_ledger"), 1));

-- Table: customer_reward_grants
CREATE TABLE IF NOT EXISTS public."customer_reward_grants" (
  "id" bigint PRIMARY KEY,
  "customer_id" bigint NOT NULL,
  "sale_id" bigint,
  "gift_card_id" bigint,
  "rule_id" bigint,
  "spend_total" numeric,
  "granted_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."customer_reward_grants_id_seq";
ALTER TABLE public."customer_reward_grants" ALTER COLUMN "id" SET DEFAULT nextval('public.customer_reward_grants_id_seq');
SELECT setval('public.customer_reward_grants_id_seq', COALESCE((SELECT MAX("id") FROM public."customer_reward_grants"), 1));

-- Table: customer_reward_rules
CREATE TABLE IF NOT EXISTS public."customer_reward_rules" (
  "id" bigint PRIMARY KEY,
  "enabled" bigint DEFAULT 1,
  "spend_threshold" numeric NOT NULL,
  "period_days" bigint NOT NULL DEFAULT 30,
  "gift_amount" numeric NOT NULL,
  "gift_expiry_days" bigint DEFAULT 365,
  "notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."customer_reward_rules_id_seq";
ALTER TABLE public."customer_reward_rules" ALTER COLUMN "id" SET DEFAULT nextval('public.customer_reward_rules_id_seq');
SELECT setval('public.customer_reward_rules_id_seq', COALESCE((SELECT MAX("id") FROM public."customer_reward_rules"), 1));

-- Table: customers
CREATE TABLE IF NOT EXISTS public."customers" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "address" text,
  "balance" numeric DEFAULT 0,
  "notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "loyalty_points" numeric DEFAULT 0,
  "is_vip" bigint DEFAULT 0,
  "birthday" text,
  "allow_on_account" bigint DEFAULT 0,
  "credit_limit" numeric,
  "on_account_frozen" bigint DEFAULT 0,
  "on_account_approved" bigint DEFAULT 0,
  "on_account_period_days" bigint,
  "on_account_due_date" text
);

CREATE SEQUENCE IF NOT EXISTS public."customers_id_seq";
ALTER TABLE public."customers" ALTER COLUMN "id" SET DEFAULT nextval('public.customers_id_seq');
SELECT setval('public.customers_id_seq', COALESCE((SELECT MAX("id") FROM public."customers"), 1));

-- Table: daily_checklist_items
CREATE TABLE IF NOT EXISTS public."daily_checklist_items" (
  "id" bigint PRIMARY KEY,
  "run_id" bigint NOT NULL,
  "template_id" bigint,
  "task_name" text NOT NULL,
  "completed" bigint DEFAULT 0,
  "comments" text,
  "completed_at" text,
  "employee_name" text,
  "item_status" text DEFAULT 'pending'
);

CREATE SEQUENCE IF NOT EXISTS public."daily_checklist_items_id_seq";
ALTER TABLE public."daily_checklist_items" ALTER COLUMN "id" SET DEFAULT nextval('public.daily_checklist_items_id_seq');
SELECT setval('public.daily_checklist_items_id_seq', COALESCE((SELECT MAX("id") FROM public."daily_checklist_items"), 1));

-- Table: daily_checklist_runs
CREATE TABLE IF NOT EXISTS public."daily_checklist_runs" (
  "id" bigint PRIMARY KEY,
  "run_type" text NOT NULL,
  "run_date" text NOT NULL,
  "branch_id" bigint,
  "employee_id" bigint,
  "status" text NOT NULL DEFAULT 'in_progress',
  "completed_at" text,
  "report_json" jsonb,
  "created_at" text DEFAULT now(),
  "submitted_at" text,
  "submitted_by" bigint,
  "confirmed_by" bigint,
  "confirmed_at" text,
  "admin_notes" text,
  "failed_at" text,
  "failure_reason" text
);

CREATE SEQUENCE IF NOT EXISTS public."daily_checklist_runs_id_seq";
ALTER TABLE public."daily_checklist_runs" ALTER COLUMN "id" SET DEFAULT nextval('public.daily_checklist_runs_id_seq');
SELECT setval('public.daily_checklist_runs_id_seq', COALESCE((SELECT MAX("id") FROM public."daily_checklist_runs"), 1));

-- Table: document_assets
CREATE TABLE IF NOT EXISTS public."document_assets" (
  "id" bigint PRIMARY KEY,
  "title" text NOT NULL,
  "doc_type" text NOT NULL DEFAULT 'other',
  "file_path" text NOT NULL,
  "thumbnail_path" text,
  "branch_id" bigint,
  "source_flyer_id" bigint,
  "schedule_at" text,
  "shared_at" text,
  "share_mode" text,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "status" text NOT NULL DEFAULT 'draft'
);

CREATE SEQUENCE IF NOT EXISTS public."document_assets_id_seq";
ALTER TABLE public."document_assets" ALTER COLUMN "id" SET DEFAULT nextval('public.document_assets_id_seq');
SELECT setval('public.document_assets_id_seq', COALESCE((SELECT MAX("id") FROM public."document_assets"), 1));

-- Table: donation_documents
CREATE TABLE IF NOT EXISTS public."donation_documents" (
  "id" bigint PRIMARY KEY,
  "donation_id" bigint NOT NULL,
  "doc_type" text NOT NULL DEFAULT 'receipt',
  "file_name" text NOT NULL,
  "file_data" text,
  "file_path" text,
  "mime_type" text,
  "uploaded_by" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."donation_documents_id_seq";
ALTER TABLE public."donation_documents" ALTER COLUMN "id" SET DEFAULT nextval('public.donation_documents_id_seq');
SELECT setval('public.donation_documents_id_seq', COALESCE((SELECT MAX("id") FROM public."donation_documents"), 1));

-- Table: donations
CREATE TABLE IF NOT EXISTS public."donations" (
  "id" bigint PRIMARY KEY,
  "donation_number" text NOT NULL,
  "donation_date" text NOT NULL,
  "amount" numeric NOT NULL DEFAULT 0,
  "donation_type" text NOT NULL DEFAULT 'Cash',
  "recipient_org" text,
  "org_reg_number" text,
  "tax_ref_number" text,
  "purpose" text,
  "payment_method" text DEFAULT 'Cash',
  "branch_id" bigint,
  "employee_id" bigint,
  "recorded_by" bigint,
  "status" text NOT NULL DEFAULT 'draft',
  "manager_approved_by" bigint,
  "manager_approved_at" text,
  "manager_comments" text,
  "admin_approved_by" bigint,
  "admin_approved_at" text,
  "admin_comments" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."donations_id_seq";
ALTER TABLE public."donations" ALTER COLUMN "id" SET DEFAULT nextval('public.donations_id_seq');
SELECT setval('public.donations_id_seq', COALESCE((SELECT MAX("id") FROM public."donations"), 1));

-- Table: employee_advances
CREATE TABLE IF NOT EXISTS public."employee_advances" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "amount" numeric NOT NULL,
  "advance_date" text DEFAULT CURRENT_DATE,
  "reason" text,
  "approved_by" bigint,
  "approved_by_name" text,
  "balance" numeric NOT NULL,
  "recovery_per_period" numeric DEFAULT 0,
  "repayment_method" text DEFAULT 'salary_deduction',
  "auto_deduct" bigint DEFAULT 1,
  "status" text DEFAULT 'outstanding',
  "settled_at" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_advances_id_seq";
ALTER TABLE public."employee_advances" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_advances_id_seq');
SELECT setval('public.employee_advances_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_advances"), 1));

-- Table: employee_attendance
CREATE TABLE IF NOT EXISTS public."employee_attendance" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "work_date" text NOT NULL,
  "clock_in" text,
  "clock_out" text,
  "break_start" text,
  "break_end" text,
  "hours_worked" numeric DEFAULT 0,
  "late_minutes" bigint DEFAULT 0,
  "early_departure_minutes" bigint DEFAULT 0,
  "status" text DEFAULT 'present',
  "notes" text,
  "created_at" text DEFAULT now(),
  "overtime_minutes" bigint DEFAULT 0,
  "break_minutes" bigint DEFAULT 0,
  "scheduled_hours" numeric DEFAULT 0,
  "deduction_amount" numeric DEFAULT 0,
  "is_paid_absence" bigint DEFAULT 1,
  "edited_by" bigint,
  "edited_at" text,
  "auto_closed" bigint DEFAULT 0,
  "admin_entered" bigint DEFAULT 0,
  "created_by" bigint,
  "created_by_name" text
);

CREATE SEQUENCE IF NOT EXISTS public."employee_attendance_id_seq";
ALTER TABLE public."employee_attendance" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_attendance_id_seq');
SELECT setval('public.employee_attendance_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_attendance"), 1));

-- Table: employee_contract_templates
CREATE TABLE IF NOT EXISTS public."employee_contract_templates" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "position" text,
  "clauses_json" jsonb,
  "is_default" bigint DEFAULT 0,
  "created_at" text DEFAULT now(),
  "body_template" text
);

CREATE SEQUENCE IF NOT EXISTS public."employee_contract_templates_id_seq";
ALTER TABLE public."employee_contract_templates" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_contract_templates_id_seq');
SELECT setval('public.employee_contract_templates_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_contract_templates"), 1));

-- Table: employee_contracts
CREATE TABLE IF NOT EXISTS public."employee_contracts" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "template_id" bigint,
  "contract_data_json" jsonb,
  "status" text DEFAULT 'draft',
  "employee_signed_at" text,
  "manager_signed_at" text,
  "admin_signed_at" text,
  "witness_signed_at" text,
  "signature_data_json" jsonb,
  "pdf_path" text,
  "created_by" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_contracts_id_seq";
ALTER TABLE public."employee_contracts" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_contracts_id_seq');
SELECT setval('public.employee_contracts_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_contracts"), 1));

-- Table: employee_damage_costs
CREATE TABLE IF NOT EXISTS public."employee_damage_costs" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "product_name" text,
  "quantity" numeric DEFAULT 1,
  "damage_value" numeric NOT NULL,
  "incident_date" text DEFAULT CURRENT_DATE,
  "reason" text,
  "approved_by" bigint,
  "approved_by_name" text,
  "photo_path" text,
  "deduction_method" text DEFAULT 'installments',
  "recovery_per_period" numeric DEFAULT 0,
  "balance" numeric NOT NULL,
  "status" text DEFAULT 'pending',
  "settled_at" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_damage_costs_id_seq";
ALTER TABLE public."employee_damage_costs" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_damage_costs_id_seq');
SELECT setval('public.employee_damage_costs_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_damage_costs"), 1));

-- Table: employee_disciplinary
CREATE TABLE IF NOT EXISTS public."employee_disciplinary" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "record_type" text,
  "incident_date" text,
  "description" text,
  "action_taken" text,
  "notes" text,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "worker_response" text,
  "worker_response_at" text,
  "requires_response" bigint DEFAULT 0,
  "status" text DEFAULT 'open',
  "pdf_path" text,
  "staff_pdf_path" text,
  "whatsapp_sent_at" text
);

CREATE SEQUENCE IF NOT EXISTS public."employee_disciplinary_id_seq";
ALTER TABLE public."employee_disciplinary" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_disciplinary_id_seq');
SELECT setval('public.employee_disciplinary_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_disciplinary"), 1));

-- Table: employee_documents
CREATE TABLE IF NOT EXISTS public."employee_documents" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "doc_type" text,
  "file_path" text,
  "file_name" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_documents_id_seq";
ALTER TABLE public."employee_documents" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_documents_id_seq');
SELECT setval('public.employee_documents_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_documents"), 1));

-- Table: employee_hr_documents
CREATE TABLE IF NOT EXISTS public."employee_hr_documents" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "document_type" text NOT NULL,
  "title" text NOT NULL,
  "content" text,
  "html_content" text,
  "incident_date" text,
  "created_by" bigint,
  "created_by_name" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_hr_documents_id_seq";
ALTER TABLE public."employee_hr_documents" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_hr_documents_id_seq');
SELECT setval('public.employee_hr_documents_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_hr_documents"), 1));

-- Table: employee_leave
CREATE TABLE IF NOT EXISTS public."employee_leave" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "leave_type" text NOT NULL,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "days" numeric DEFAULT 1,
  "status" text DEFAULT 'pending',
  "notes" text,
  "approved_by" bigint,
  "created_at" text DEFAULT now(),
  "proof_path" text,
  "proof_submitted_at" text,
  "proof_confirmed_by" bigint,
  "proof_confirmed_at" text,
  "pdf_path" text,
  "approved_at" text
);

CREATE SEQUENCE IF NOT EXISTS public."employee_leave_id_seq";
ALTER TABLE public."employee_leave" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_leave_id_seq');
SELECT setval('public.employee_leave_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_leave"), 1));

-- Table: employee_loans
CREATE TABLE IF NOT EXISTS public."employee_loans" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "loan_amount" numeric NOT NULL,
  "interest_rate" numeric DEFAULT 0,
  "loan_date" text DEFAULT CURRENT_DATE,
  "monthly_deduction" numeric NOT NULL,
  "installments" bigint DEFAULT 0,
  "balance" numeric NOT NULL,
  "status" text DEFAULT 'active',
  "settled_at" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_loans_id_seq";
ALTER TABLE public."employee_loans" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_loans_id_seq');
SELECT setval('public.employee_loans_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_loans"), 1));

-- Table: employee_of_month
CREATE TABLE IF NOT EXISTS public."employee_of_month" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "month_year" text NOT NULL,
  "score" numeric DEFAULT 0,
  "photo_path" text,
  "bonus_amount" numeric DEFAULT 0,
  "certificate_path" text,
  "notes" text,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "is_active" bigint DEFAULT 1,
  "display_until" text,
  "bonus_payroll_month" text
);

CREATE SEQUENCE IF NOT EXISTS public."employee_of_month_id_seq";
ALTER TABLE public."employee_of_month" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_of_month_id_seq');
SELECT setval('public.employee_of_month_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_of_month"), 1));

-- Table: employee_of_month_scores
CREATE TABLE IF NOT EXISTS public."employee_of_month_scores" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "month_year" text NOT NULL,
  "sales_score" numeric DEFAULT 0,
  "shift_score" numeric DEFAULT 0,
  "checklist_score" numeric DEFAULT 0,
  "attendance_score" numeric DEFAULT 0,
  "total_score" numeric DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."employee_of_month_scores_id_seq";
ALTER TABLE public."employee_of_month_scores" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_of_month_scores_id_seq');
SELECT setval('public.employee_of_month_scores_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_of_month_scores"), 1));

-- Table: employee_payroll
CREATE TABLE IF NOT EXISTS public."employee_payroll" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "period_start" text,
  "period_end" text,
  "basic_salary" numeric DEFAULT 0,
  "overtime_pay" numeric DEFAULT 0,
  "bonus" numeric DEFAULT 0,
  "commission" numeric DEFAULT 0,
  "allowances" numeric DEFAULT 0,
  "deductions" numeric DEFAULT 0,
  "net_salary" numeric DEFAULT 0,
  "payment_method" text DEFAULT 'cash',
  "status" text DEFAULT 'pending',
  "paid_at" text,
  "notes" text,
  "created_at" text DEFAULT now(),
  "gross_salary" numeric DEFAULT 0,
  "paye" numeric DEFAULT 0,
  "uif_employee" numeric DEFAULT 0,
  "uif_employer" numeric DEFAULT 0,
  "sdl" numeric DEFAULT 0,
  "coida" numeric DEFAULT 0,
  "advance_recovery" numeric DEFAULT 0,
  "loan_recovery" numeric DEFAULT 0,
  "damage_recovery" numeric DEFAULT 0,
  "pension_deduction" numeric DEFAULT 0,
  "medical_deduction" numeric DEFAULT 0,
  "other_deductions" numeric DEFAULT 0,
  "employer_pension" numeric DEFAULT 0,
  "employer_medical" numeric DEFAULT 0,
  "employer_other" numeric DEFAULT 0,
  "scheduled_hours" numeric DEFAULT 0,
  "hours_worked" numeric DEFAULT 0,
  "hours_missed" numeric DEFAULT 0,
  "late_minutes" bigint DEFAULT 0,
  "overtime_hours" numeric DEFAULT 0,
  "attendance_deductions" numeric DEFAULT 0,
  "attendance_json" jsonb
);

CREATE SEQUENCE IF NOT EXISTS public."employee_payroll_id_seq";
ALTER TABLE public."employee_payroll" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_payroll_id_seq');
SELECT setval('public.employee_payroll_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_payroll"), 1));

-- Table: employee_payroll_deductions
CREATE TABLE IF NOT EXISTS public."employee_payroll_deductions" (
  "id" bigint PRIMARY KEY,
  "payroll_id" bigint NOT NULL,
  "deduction_type" text NOT NULL,
  "reference_id" bigint,
  "description" text,
  "amount" numeric NOT NULL DEFAULT 0,
  "is_employer" bigint DEFAULT 0,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_payroll_deductions_id_seq";
ALTER TABLE public."employee_payroll_deductions" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_payroll_deductions_id_seq');
SELECT setval('public.employee_payroll_deductions_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_payroll_deductions"), 1));

-- Table: employee_portal_feed
CREATE TABLE IF NOT EXISTS public."employee_portal_feed" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "feed_type" text NOT NULL,
  "title" text NOT NULL,
  "message" text,
  "photo_path" text,
  "ref_id" bigint,
  "is_read" bigint DEFAULT 0,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_portal_feed_id_seq";
ALTER TABLE public."employee_portal_feed" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_portal_feed_id_seq');
SELECT setval('public.employee_portal_feed_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_portal_feed"), 1));

-- Table: employee_probation
CREATE TABLE IF NOT EXISTS public."employee_probation" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "duration_days" bigint NOT NULL DEFAULT 90,
  "manager_id" bigint,
  "status" text DEFAULT 'active',
  "rules_json" jsonb,
  "final_decision" text,
  "decision_date" text,
  "decision_by" bigint,
  "decision_reason" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_probation_id_seq";
ALTER TABLE public."employee_probation" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_probation_id_seq');
SELECT setval('public.employee_probation_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_probation"), 1));

-- Table: employee_schedules
CREATE TABLE IF NOT EXISTS public."employee_schedules" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "shift_name" text,
  "shift_date" text NOT NULL,
  "start_time" text,
  "end_time" text,
  "is_rest_day" bigint DEFAULT 0,
  "branch" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."employee_schedules_id_seq";
ALTER TABLE public."employee_schedules" ALTER COLUMN "id" SET DEFAULT nextval('public.employee_schedules_id_seq');
SELECT setval('public.employee_schedules_id_seq', COALESCE((SELECT MAX("id") FROM public."employee_schedules"), 1));

-- Table: employees
CREATE TABLE IF NOT EXISTS public."employees" (
  "id" bigint PRIMARY KEY,
  "employee_code" text NOT NULL,
  "full_name" text NOT NULL,
  "photo_path" text,
  "phone" text,
  "email" text,
  "address" text,
  "id_number" text,
  "date_of_birth" text,
  "gender" text,
  "emergency_contact" text,
  "emergency_phone" text,
  "position" text,
  "department" text,
  "branch" text,
  "date_hired" text,
  "employment_type" text DEFAULT 'Permanent',
  "status" text DEFAULT 'Active',
  "salary_type" text DEFAULT 'Monthly',
  "basic_salary" numeric DEFAULT 0,
  "overtime_rate" numeric DEFAULT 0,
  "bonus" numeric DEFAULT 0,
  "commission" numeric DEFAULT 0,
  "allowances" numeric DEFAULT 0,
  "deductions" numeric DEFAULT 0,
  "pin" text,
  "user_id" bigint,
  "leave_annual" numeric DEFAULT 15,
  "leave_sick" numeric DEFAULT 10,
  "leave_family" numeric DEFAULT 3,
  "notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "tax_number" text,
  "uif_number" text,
  "bank_name" text,
  "bank_account" text,
  "pension_contribution" numeric DEFAULT 0,
  "medical_aid_contribution" numeric DEFAULT 0,
  "work_schedule" text,
  "employee_number" text,
  "payment_date" text,
  "paye_registered" bigint DEFAULT 0,
  "uif_registered" bigint DEFAULT 0,
  "pension_registered" bigint DEFAULT 0,
  "medical_registered" bigint DEFAULT 0,
  "sdl_registered" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."employees_id_seq";
ALTER TABLE public."employees" ALTER COLUMN "id" SET DEFAULT nextval('public.employees_id_seq');
SELECT setval('public.employees_id_seq', COALESCE((SELECT MAX("id") FROM public."employees"), 1));

-- Table: exchanges
CREATE TABLE IF NOT EXISTS public."exchanges" (
  "id" bigint PRIMARY KEY,
  "return_id" bigint,
  "sale_id" bigint,
  "original_product_id" bigint,
  "new_product_id" bigint,
  "original_product_name" text,
  "new_product_name" text,
  "price_difference" numeric DEFAULT 0,
  "notes" text,
  "user_id" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."exchanges_id_seq";
ALTER TABLE public."exchanges" ALTER COLUMN "id" SET DEFAULT nextval('public.exchanges_id_seq');
SELECT setval('public.exchanges_id_seq', COALESCE((SELECT MAX("id") FROM public."exchanges"), 1));

-- Table: expenses
CREATE TABLE IF NOT EXISTS public."expenses" (
  "id" bigint PRIMARY KEY,
  "category" text NOT NULL,
  "description" text,
  "amount" numeric NOT NULL,
  "user_id" bigint,
  "expense_date" text DEFAULT CURRENT_DATE,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."expenses_id_seq";
ALTER TABLE public."expenses" ALTER COLUMN "id" SET DEFAULT nextval('public.expenses_id_seq');
SELECT setval('public.expenses_id_seq', COALESCE((SELECT MAX("id") FROM public."expenses"), 1));

-- Table: financial_audit_trail
CREATE TABLE IF NOT EXISTS public."financial_audit_trail" (
  "id" bigint PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_id" bigint,
  "action" text NOT NULL,
  "field_name" text,
  "previous_value" text,
  "new_value" text,
  "user_id" bigint,
  "user_name" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."financial_audit_trail_id_seq";
ALTER TABLE public."financial_audit_trail" ALTER COLUMN "id" SET DEFAULT nextval('public.financial_audit_trail_id_seq');
SELECT setval('public.financial_audit_trail_id_seq', COALESCE((SELECT MAX("id") FROM public."financial_audit_trail"), 1));

-- Table: financial_documents
CREATE TABLE IF NOT EXISTS public."financial_documents" (
  "id" bigint PRIMARY KEY,
  "doc_type" text NOT NULL,
  "title" text,
  "file_path" text,
  "file_name" text,
  "amount" numeric,
  "doc_date" text,
  "reference_type" text,
  "reference_id" bigint,
  "employee_id" bigint,
  "customer_id" bigint,
  "supplier_id" bigint,
  "uploaded_by" bigint,
  "uploaded_by_name" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."financial_documents_id_seq";
ALTER TABLE public."financial_documents" ALTER COLUMN "id" SET DEFAULT nextval('public.financial_documents_id_seq');
SELECT setval('public.financial_documents_id_seq', COALESCE((SELECT MAX("id") FROM public."financial_documents"), 1));

-- Table: flyer_templates
CREATE TABLE IF NOT EXISTS public."flyer_templates" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "category" text,
  "canvas_json" jsonb,
  "is_builtin" bigint DEFAULT 0,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."flyer_templates_id_seq";
ALTER TABLE public."flyer_templates" ALTER COLUMN "id" SET DEFAULT nextval('public.flyer_templates_id_seq');
SELECT setval('public.flyer_templates_id_seq', COALESCE((SELECT MAX("id") FROM public."flyer_templates"), 1));

-- Table: gift_card_transactions
CREATE TABLE IF NOT EXISTS public."gift_card_transactions" (
  "id" bigint PRIMARY KEY,
  "gift_card_id" bigint NOT NULL,
  "amount" numeric NOT NULL,
  "type" text NOT NULL,
  "sale_id" bigint,
  "user_id" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."gift_card_transactions_id_seq";
ALTER TABLE public."gift_card_transactions" ALTER COLUMN "id" SET DEFAULT nextval('public.gift_card_transactions_id_seq');
SELECT setval('public.gift_card_transactions_id_seq', COALESCE((SELECT MAX("id") FROM public."gift_card_transactions"), 1));

-- Table: gift_cards
CREATE TABLE IF NOT EXISTS public."gift_cards" (
  "id" bigint PRIMARY KEY,
  "code" text NOT NULL,
  "initial_balance" numeric NOT NULL,
  "balance" numeric NOT NULL,
  "customer_id" bigint,
  "branch_id" bigint DEFAULT 1,
  "status" text DEFAULT 'active',
  "expires_at" text,
  "created_at" text DEFAULT now(),
  "customer_phone" text,
  "created_by" bigint,
  "notes" text,
  "approval_status" text DEFAULT 'approved',
  "approved_by" bigint,
  "approved_at" text
);

CREATE SEQUENCE IF NOT EXISTS public."gift_cards_id_seq";
ALTER TABLE public."gift_cards" ALTER COLUMN "id" SET DEFAULT nextval('public.gift_cards_id_seq');
SELECT setval('public.gift_cards_id_seq', COALESCE((SELECT MAX("id") FROM public."gift_cards"), 1));

-- Table: held_orders
CREATE TABLE IF NOT EXISTS public."held_orders" (
  "id" bigint PRIMARY KEY,
  "name" text,
  "user_id" bigint,
  "cart_data" jsonb NOT NULL,
  "created_at" text DEFAULT now(),
  "branch_id" bigint DEFAULT 1,
  "customer_id" bigint,
  "label" text
);

CREATE SEQUENCE IF NOT EXISTS public."held_orders_id_seq";
ALTER TABLE public."held_orders" ALTER COLUMN "id" SET DEFAULT nextval('public.held_orders_id_seq');
SELECT setval('public.held_orders_id_seq', COALESCE((SELECT MAX("id") FROM public."held_orders"), 1));

-- Table: hr_contract_templates
CREATE TABLE IF NOT EXISTS public."hr_contract_templates" (
  "id" bigint PRIMARY KEY,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "template_key" text
);

CREATE SEQUENCE IF NOT EXISTS public."hr_contract_templates_id_seq";
ALTER TABLE public."hr_contract_templates" ALTER COLUMN "id" SET DEFAULT nextval('public.hr_contract_templates_id_seq');
SELECT setval('public.hr_contract_templates_id_seq', COALESCE((SELECT MAX("id") FROM public."hr_contract_templates"), 1));

-- Table: hr_staff_submissions
CREATE TABLE IF NOT EXISTS public."hr_staff_submissions" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "template_type" text NOT NULL,
  "template_id" bigint,
  "filled_data" text,
  "doc_paths" text,
  "status" text NOT NULL DEFAULT 'pending',
  "reviewed_by" bigint,
  "reviewed_at" text,
  "review_notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "assigned_to_user_id" bigint,
  "submitted_by" bigint,
  "submitted_at" text
);

CREATE SEQUENCE IF NOT EXISTS public."hr_staff_submissions_id_seq";
ALTER TABLE public."hr_staff_submissions" ALTER COLUMN "id" SET DEFAULT nextval('public.hr_staff_submissions_id_seq');
SELECT setval('public.hr_staff_submissions_id_seq', COALESCE((SELECT MAX("id") FROM public."hr_staff_submissions"), 1));

-- Table: hr_training_records
CREATE TABLE IF NOT EXISTS public."hr_training_records" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "start_date" text NOT NULL,
  "expiry_date" text,
  "status" text NOT NULL DEFAULT 'active',
  "evaluations_json" jsonb,
  "template_id" bigint,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."hr_training_records_id_seq";
ALTER TABLE public."hr_training_records" ALTER COLUMN "id" SET DEFAULT nextval('public.hr_training_records_id_seq');
SELECT setval('public.hr_training_records_id_seq', COALESCE((SELECT MAX("id") FROM public."hr_training_records"), 1));

-- Table: income_entries
CREATE TABLE IF NOT EXISTS public."income_entries" (
  "id" bigint PRIMARY KEY,
  "income_type" text NOT NULL,
  "category" text,
  "description" text,
  "amount" numeric NOT NULL,
  "income_date" text NOT NULL,
  "payment_method" text DEFAULT 'cash',
  "account_type" text DEFAULT 'cash',
  "customer_id" bigint,
  "reference" text,
  "created_by" bigint,
  "created_by_name" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."income_entries_id_seq";
ALTER TABLE public."income_entries" ALTER COLUMN "id" SET DEFAULT nextval('public.income_entries_id_seq');
SELECT setval('public.income_entries_id_seq', COALESCE((SELECT MAX("id") FROM public."income_entries"), 1));

-- Table: job_candidates
CREATE TABLE IF NOT EXISTS public."job_candidates" (
  "id" bigint PRIMARY KEY,
  "posting_id" bigint NOT NULL,
  "name" text NOT NULL,
  "phone" text,
  "location" text,
  "cv_path" text,
  "status" text NOT NULL DEFAULT 'new',
  "employ_request_by" bigint,
  "employ_request_at" text,
  "admin_decision" text,
  "admin_decision_by" bigint,
  "admin_decision_at" text,
  "admin_notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "address" text,
  "pictures_json" jsonb,
  "interview_at" text,
  "interview_location" text,
  "interview_notes" text,
  "interview_doc_path" text,
  "interview_result_path" text,
  "interview_status" text,
  "interview_assigned_to" text
);

CREATE SEQUENCE IF NOT EXISTS public."job_candidates_id_seq";
ALTER TABLE public."job_candidates" ALTER COLUMN "id" SET DEFAULT nextval('public.job_candidates_id_seq');
SELECT setval('public.job_candidates_id_seq', COALESCE((SELECT MAX("id") FROM public."job_candidates"), 1));

-- Table: job_postings
CREATE TABLE IF NOT EXISTS public."job_postings" (
  "id" bigint PRIMARY KEY,
  "title" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_by" bigint,
  "approved_by" bigint,
  "approved_at" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."job_postings_id_seq";
ALTER TABLE public."job_postings" ALTER COLUMN "id" SET DEFAULT nextval('public.job_postings_id_seq');
SELECT setval('public.job_postings_id_seq', COALESCE((SELECT MAX("id") FROM public."job_postings"), 1));

-- Table: kitchen_order_items
CREATE TABLE IF NOT EXISTS public."kitchen_order_items" (
  "id" bigint PRIMARY KEY,
  "kitchen_order_id" bigint NOT NULL,
  "product_name" text NOT NULL,
  "quantity" numeric NOT NULL,
  "modifiers" text,
  "notes" text
);

CREATE SEQUENCE IF NOT EXISTS public."kitchen_order_items_id_seq";
ALTER TABLE public."kitchen_order_items" ALTER COLUMN "id" SET DEFAULT nextval('public.kitchen_order_items_id_seq');
SELECT setval('public.kitchen_order_items_id_seq', COALESCE((SELECT MAX("id") FROM public."kitchen_order_items"), 1));

-- Table: kitchen_orders
CREATE TABLE IF NOT EXISTS public."kitchen_orders" (
  "id" bigint PRIMARY KEY,
  "order_number" text NOT NULL,
  "sale_id" bigint,
  "table_id" bigint,
  "waiter_id" bigint,
  "station" text DEFAULT 'kitchen',
  "status" text DEFAULT 'pending',
  "branch_id" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."kitchen_orders_id_seq";
ALTER TABLE public."kitchen_orders" ALTER COLUMN "id" SET DEFAULT nextval('public.kitchen_orders_id_seq');
SELECT setval('public.kitchen_orders_id_seq', COALESCE((SELECT MAX("id") FROM public."kitchen_orders"), 1));

-- Table: layby_counter
CREATE TABLE IF NOT EXISTS public."layby_counter" (
  "id" bigint PRIMARY KEY,
  "last_number" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."layby_counter_id_seq";
ALTER TABLE public."layby_counter" ALTER COLUMN "id" SET DEFAULT nextval('public.layby_counter_id_seq');
SELECT setval('public.layby_counter_id_seq', COALESCE((SELECT MAX("id") FROM public."layby_counter"), 1));

-- Table: layby_items
CREATE TABLE IF NOT EXISTS public."layby_items" (
  "id" bigint PRIMARY KEY,
  "layby_id" bigint NOT NULL,
  "product_id" bigint,
  "product_name" text NOT NULL,
  "quantity" numeric NOT NULL,
  "unit_price" numeric NOT NULL,
  "total" numeric NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public."layby_items_id_seq";
ALTER TABLE public."layby_items" ALTER COLUMN "id" SET DEFAULT nextval('public.layby_items_id_seq');
SELECT setval('public.layby_items_id_seq', COALESCE((SELECT MAX("id") FROM public."layby_items"), 1));

-- Table: layby_payments
CREATE TABLE IF NOT EXISTS public."layby_payments" (
  "id" bigint PRIMARY KEY,
  "layby_id" bigint NOT NULL,
  "amount" numeric NOT NULL,
  "payment_type" text DEFAULT 'cash',
  "user_id" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."layby_payments_id_seq";
ALTER TABLE public."layby_payments" ALTER COLUMN "id" SET DEFAULT nextval('public.layby_payments_id_seq');
SELECT setval('public.layby_payments_id_seq', COALESCE((SELECT MAX("id") FROM public."layby_payments"), 1));

-- Table: laybyes
CREATE TABLE IF NOT EXISTS public."laybyes" (
  "id" bigint PRIMARY KEY,
  "layby_number" text NOT NULL,
  "customer_id" bigint NOT NULL,
  "user_id" bigint,
  "branch_id" bigint DEFAULT 1,
  "total" numeric NOT NULL,
  "amount_paid" numeric DEFAULT 0,
  "balance" numeric NOT NULL,
  "status" text DEFAULT 'active',
  "notes" text,
  "created_at" text DEFAULT now(),
  "completed_at" text,
  "expires_at" text,
  "refund_fee" numeric DEFAULT 0,
  "refunded_amount" numeric DEFAULT 0,
  "cancelled_at" text
);

CREATE SEQUENCE IF NOT EXISTS public."laybyes_id_seq";
ALTER TABLE public."laybyes" ALTER COLUMN "id" SET DEFAULT nextval('public.laybyes_id_seq');
SELECT setval('public.laybyes_id_seq', COALESCE((SELECT MAX("id") FROM public."laybyes"), 1));

-- Table: ledger_entries
CREATE TABLE IF NOT EXISTS public."ledger_entries" (
  "id" bigint PRIMARY KEY,
  "txn_number" text NOT NULL,
  "txn_date" text NOT NULL,
  "txn_type" text NOT NULL,
  "category" text,
  "subcategory" text,
  "description" text,
  "amount" numeric NOT NULL,
  "direction" text NOT NULL,
  "payment_method" text,
  "account_type" text DEFAULT 'cash',
  "reference_type" text,
  "reference_id" bigint,
  "employee_id" bigint,
  "customer_id" bigint,
  "supplier_id" bigint,
  "branch" text DEFAULT 'main',
  "is_auto" bigint DEFAULT 0,
  "created_by" bigint,
  "created_by_name" text,
  "approved_by" bigint,
  "approved_by_name" text,
  "notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."ledger_entries_id_seq";
ALTER TABLE public."ledger_entries" ALTER COLUMN "id" SET DEFAULT nextval('public.ledger_entries_id_seq');
SELECT setval('public.ledger_entries_id_seq', COALESCE((SELECT MAX("id") FROM public."ledger_entries"), 1));

-- Table: loyalty_transactions
CREATE TABLE IF NOT EXISTS public."loyalty_transactions" (
  "id" bigint PRIMARY KEY,
  "customer_id" bigint NOT NULL,
  "points" numeric NOT NULL,
  "type" text NOT NULL,
  "sale_id" bigint,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."loyalty_transactions_id_seq";
ALTER TABLE public."loyalty_transactions" ALTER COLUMN "id" SET DEFAULT nextval('public.loyalty_transactions_id_seq');
SELECT setval('public.loyalty_transactions_id_seq', COALESCE((SELECT MAX("id") FROM public."loyalty_transactions"), 1));

-- Table: marketing_access_tokens
CREATE TABLE IF NOT EXISTS public."marketing_access_tokens" (
  "id" bigint PRIMARY KEY,
  "agent_id" bigint NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" text NOT NULL,
  "revoked_at" text,
  "device_id" text,
  "created_at" text DEFAULT now(),
  "created_by" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_access_tokens_id_seq";
ALTER TABLE public."marketing_access_tokens" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_access_tokens_id_seq');
SELECT setval('public.marketing_access_tokens_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_access_tokens"), 1));

-- Table: marketing_agents
CREATE TABLE IF NOT EXISTS public."marketing_agents" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint NOT NULL,
  "branch_id" bigint,
  "referral_code" text,
  "status" text DEFAULT 'active',
  "permissions_json" jsonb DEFAULT '{}',
  "targets_json" jsonb DEFAULT '{}',
  "device_id" text,
  "last_activity_at" text,
  "notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "created_by" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_agents_id_seq";
ALTER TABLE public."marketing_agents" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_agents_id_seq');
SELECT setval('public.marketing_agents_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_agents"), 1));

-- Table: marketing_audit_log
CREATE TABLE IF NOT EXISTS public."marketing_audit_log" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint,
  "username" text,
  "agent_id" bigint,
  "action" text NOT NULL,
  "entity_type" text,
  "entity_id" bigint,
  "details_json" jsonb,
  "device_id" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_audit_log_id_seq";
ALTER TABLE public."marketing_audit_log" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_audit_log_id_seq');
SELECT setval('public.marketing_audit_log_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_audit_log"), 1));

-- Table: marketing_campaigns
CREATE TABLE IF NOT EXISTS public."marketing_campaigns" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "name" text NOT NULL,
  "objective" text,
  "start_date" text,
  "end_date" text,
  "branch_id" bigint,
  "agent_id" bigint,
  "products_json" jsonb,
  "target_group" text,
  "offer_text" text,
  "flyer_id" bigint,
  "menu_id" bigint,
  "status" text DEFAULT 'draft',
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "created_by" bigint,
  "updated_by" bigint,
  "device_id" text,
  "sync_status" text DEFAULT 'synced',
  "version" bigint DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_campaigns_id_seq";
ALTER TABLE public."marketing_campaigns" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_campaigns_id_seq');
SELECT setval('public.marketing_campaigns_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_campaigns"), 1));

-- Table: marketing_customers
CREATE TABLE IF NOT EXISTS public."marketing_customers" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "customer_id" bigint,
  "agent_id" bigint,
  "full_name" text NOT NULL,
  "phone" text,
  "branch_id" bigint,
  "source" text,
  "customer_type" text DEFAULT 'new',
  "group_tag" text,
  "marketing_consent" bigint DEFAULT 1,
  "referral_code" text,
  "notes" text,
  "first_purchase_at" text,
  "conversion_status" text DEFAULT 'recruited',
  "favourite_products_json" jsonb,
  "last_purchase_at" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "created_by" bigint,
  "updated_by" bigint,
  "device_id" text,
  "sync_status" text DEFAULT 'synced',
  "version" bigint DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_customers_id_seq";
ALTER TABLE public."marketing_customers" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_customers_id_seq');
SELECT setval('public.marketing_customers_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_customers"), 1));

-- Table: marketing_feedback
CREATE TABLE IF NOT EXISTS public."marketing_feedback" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "agent_id" bigint,
  "customer_name" text,
  "phone" text,
  "feedback_type" text DEFAULT 'suggestion',
  "product_request" text,
  "notes" text,
  "branch_id" bigint,
  "created_at" text DEFAULT now(),
  "sync_status" text DEFAULT 'synced'
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_feedback_id_seq";
ALTER TABLE public."marketing_feedback" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_feedback_id_seq');
SELECT setval('public.marketing_feedback_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_feedback"), 1));

-- Table: marketing_media
CREATE TABLE IF NOT EXISTS public."marketing_media" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "title" text,
  "file_path" text NOT NULL,
  "media_type" text DEFAULT 'image',
  "tags_json" jsonb,
  "approval_status" text DEFAULT 'approved',
  "uploaded_by" bigint,
  "created_at" text DEFAULT now(),
  "sync_status" text DEFAULT 'synced'
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_media_id_seq";
ALTER TABLE public."marketing_media" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_media_id_seq');
SELECT setval('public.marketing_media_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_media"), 1));

-- Table: marketing_menu_templates
CREATE TABLE IF NOT EXISTS public."marketing_menu_templates" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "title" text NOT NULL,
  "menu_type" text DEFAULT 'main',
  "pages_json" jsonb,
  "products_json" jsonb,
  "branding_json" jsonb,
  "page_size" text DEFAULT 'A4',
  "is_locked" bigint DEFAULT 0,
  "created_by" bigint,
  "agent_id" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_menu_templates_id_seq";
ALTER TABLE public."marketing_menu_templates" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_menu_templates_id_seq');
SELECT setval('public.marketing_menu_templates_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_menu_templates"), 1));

-- Table: marketing_menus
CREATE TABLE IF NOT EXISTS public."marketing_menus" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "menu_number" text,
  "title" text NOT NULL,
  "menu_type" text DEFAULT 'main',
  "branch_id" bigint,
  "agent_id" bigint,
  "pages_json" jsonb,
  "products_json" jsonb,
  "branding_json" jsonb,
  "status" text DEFAULT 'draft',
  "approval_status" text DEFAULT 'draft',
  "approval_notes" text,
  "submitted_at" text,
  "approved_by" bigint,
  "approved_at" text,
  "price_snapshot_json" jsonb,
  "digital_slug" text,
  "qr_payload" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "created_by" bigint,
  "updated_by" bigint,
  "device_id" text,
  "sync_status" text DEFAULT 'synced',
  "version" bigint DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_menus_id_seq";
ALTER TABLE public."marketing_menus" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_menus_id_seq');
SELECT setval('public.marketing_menus_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_menus"), 1));

-- Table: marketing_message_templates
CREATE TABLE IF NOT EXISTS public."marketing_message_templates" (
  "id" bigint PRIMARY KEY,
  "template_key" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "is_active" bigint DEFAULT 1,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_message_templates_id_seq";
ALTER TABLE public."marketing_message_templates" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_message_templates_id_seq');
SELECT setval('public.marketing_message_templates_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_message_templates"), 1));

-- Table: marketing_messages
CREATE TABLE IF NOT EXISTS public."marketing_messages" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "agent_id" bigint,
  "campaign_id" bigint,
  "template_key" text,
  "audience_json" jsonb,
  "message_body" text NOT NULL,
  "recipient_count" bigint DEFAULT 0,
  "status" text DEFAULT 'draft',
  "scheduled_at" text,
  "sent_at" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "sync_status" text DEFAULT 'synced'
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_messages_id_seq";
ALTER TABLE public."marketing_messages" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_messages_id_seq');
SELECT setval('public.marketing_messages_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_messages"), 1));

-- Table: marketing_notifications
CREATE TABLE IF NOT EXISTS public."marketing_notifications" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint,
  "agent_id" bigint,
  "title" text NOT NULL,
  "body" text,
  "kind" text DEFAULT 'info',
  "is_read" bigint DEFAULT 0,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_notifications_id_seq";
ALTER TABLE public."marketing_notifications" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_notifications_id_seq');
SELECT setval('public.marketing_notifications_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_notifications"), 1));

-- Table: marketing_referrals
CREATE TABLE IF NOT EXISTS public."marketing_referrals" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "agent_id" bigint NOT NULL,
  "referral_code" text NOT NULL,
  "marketing_customer_id" bigint,
  "customer_id" bigint,
  "status" text DEFAULT 'pending',
  "first_purchase_total" numeric DEFAULT 0,
  "repeat_purchases" bigint DEFAULT 0,
  "revenue" numeric DEFAULT 0,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "sync_status" text DEFAULT 'synced'
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_referrals_id_seq";
ALTER TABLE public."marketing_referrals" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_referrals_id_seq');
SELECT setval('public.marketing_referrals_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_referrals"), 1));

-- Table: marketing_reports
CREATE TABLE IF NOT EXISTS public."marketing_reports" (
  "id" bigint PRIMARY KEY,
  "uid" text,
  "agent_id" bigint NOT NULL,
  "period_label" text,
  "work_completed" text,
  "customers_recruited" bigint DEFAULT 0,
  "campaigns_count" bigint DEFAULT 0,
  "flyers_count" bigint DEFAULT 0,
  "menus_count" bigint DEFAULT 0,
  "messages_count" bigint DEFAULT 0,
  "referrals_count" bigint DEFAULT 0,
  "customer_feedback" text,
  "problems" text,
  "recommendations" text,
  "next_steps" text,
  "attachments_json" jsonb,
  "status" text DEFAULT 'submitted',
  "admin_response" text,
  "reviewed_by" bigint,
  "reviewed_at" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "sync_status" text DEFAULT 'synced'
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_reports_id_seq";
ALTER TABLE public."marketing_reports" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_reports_id_seq');
SELECT setval('public.marketing_reports_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_reports"), 1));

-- Table: marketing_sync_conflicts
CREATE TABLE IF NOT EXISTS public."marketing_sync_conflicts" (
  "id" bigint PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_uid" text NOT NULL,
  "local_version" bigint,
  "remote_version" bigint,
  "local_json" jsonb,
  "remote_json" jsonb,
  "status" text DEFAULT 'open',
  "created_at" text DEFAULT now(),
  "resolved_at" text,
  "resolved_by" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_sync_conflicts_id_seq";
ALTER TABLE public."marketing_sync_conflicts" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_sync_conflicts_id_seq');
SELECT setval('public.marketing_sync_conflicts_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_sync_conflicts"), 1));

-- Table: marketing_sync_queue
CREATE TABLE IF NOT EXISTS public."marketing_sync_queue" (
  "id" bigint PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_uid" text NOT NULL,
  "payload_json" jsonb NOT NULL,
  "op" text DEFAULT 'upsert',
  "status" text DEFAULT 'pending',
  "attempts" bigint DEFAULT 0,
  "last_error" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_sync_queue_id_seq";
ALTER TABLE public."marketing_sync_queue" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_sync_queue_id_seq');
SELECT setval('public.marketing_sync_queue_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_sync_queue"), 1));

-- Table: marketing_tasks
CREATE TABLE IF NOT EXISTS public."marketing_tasks" (
  "id" bigint PRIMARY KEY,
  "agent_id" bigint,
  "title" text NOT NULL,
  "description" text,
  "task_type" text DEFAULT 'general',
  "branch_id" bigint,
  "target_value" numeric DEFAULT 0,
  "actual_value" numeric DEFAULT 0,
  "status" text DEFAULT 'not_started',
  "due_date" text,
  "assigned_by" bigint,
  "completed_at" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "sync_status" text DEFAULT 'synced',
  "uid" text
);

CREATE SEQUENCE IF NOT EXISTS public."marketing_tasks_id_seq";
ALTER TABLE public."marketing_tasks" ALTER COLUMN "id" SET DEFAULT nextval('public.marketing_tasks_id_seq');
SELECT setval('public.marketing_tasks_id_seq', COALESCE((SELECT MAX("id") FROM public."marketing_tasks"), 1));

-- Table: notifications
CREATE TABLE IF NOT EXISTS public."notifications" (
  "id" bigint PRIMARY KEY,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "message" text,
  "is_read" bigint DEFAULT 0,
  "created_at" text DEFAULT now(),
  "entity_type" text,
  "entity_id" bigint,
  "action_page" text,
  "audience_roles" text
);

CREATE SEQUENCE IF NOT EXISTS public."notifications_id_seq";
ALTER TABLE public."notifications" ALTER COLUMN "id" SET DEFAULT nextval('public.notifications_id_seq');
SELECT setval('public.notifications_id_seq', COALESCE((SELECT MAX("id") FROM public."notifications"), 1));

-- Archived (online ordering / hub sync removed from product): online_orders_local → legacy_online_orders_local
CREATE TABLE IF NOT EXISTS public."legacy_online_orders_local" (
  "id" bigint PRIMARY KEY,
  "remote_id" bigint,
  "order_number" text,
  "branch_id" bigint DEFAULT 1,
  "customer_name" text,
  "customer_phone" text,
  "items_json" jsonb,
  "total" numeric DEFAULT 0,
  "status" text DEFAULT 'pending',
  "notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "sale_id" bigint,
  "fulfillment" text
);

CREATE SEQUENCE IF NOT EXISTS public."legacy_online_orders_local_id_seq";
ALTER TABLE public."legacy_online_orders_local" ALTER COLUMN "id" SET DEFAULT nextval('public.legacy_online_orders_local_id_seq');
SELECT setval('public.legacy_online_orders_local_id_seq', COALESCE((SELECT MAX("id") FROM public."legacy_online_orders_local"), 1));

-- Table: opening_checklist_templates
CREATE TABLE IF NOT EXISTS public."opening_checklist_templates" (
  "id" bigint PRIMARY KEY,
  "task_name" text NOT NULL,
  "sort_order" bigint DEFAULT 0,
  "is_required" bigint DEFAULT 1,
  "is_active" bigint DEFAULT 1,
  "created_by" bigint,
  "assigned_employee_id" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."opening_checklist_templates_id_seq";
ALTER TABLE public."opening_checklist_templates" ALTER COLUMN "id" SET DEFAULT nextval('public.opening_checklist_templates_id_seq');
SELECT setval('public.opening_checklist_templates_id_seq', COALESCE((SELECT MAX("id") FROM public."opening_checklist_templates"), 1));

-- Table: order_counter
CREATE TABLE IF NOT EXISTS public."order_counter" (
  "id" bigint PRIMARY KEY,
  "last_number" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."order_counter_id_seq";
ALTER TABLE public."order_counter" ALTER COLUMN "id" SET DEFAULT nextval('public.order_counter_id_seq');
SELECT setval('public.order_counter_id_seq', COALESCE((SELECT MAX("id") FROM public."order_counter"), 1));

-- Table: owner_draws
CREATE TABLE IF NOT EXISTS public."owner_draws" (
  "id" bigint PRIMARY KEY,
  "profile_id" bigint NOT NULL,
  "draw_date" text NOT NULL,
  "draw_type" text NOT NULL DEFAULT 'cash',
  "amount" numeric NOT NULL DEFAULT 0,
  "description" text,
  "period_id" bigint,
  "created_by" bigint,
  "created_by_name" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."owner_draws_id_seq";
ALTER TABLE public."owner_draws" ALTER COLUMN "id" SET DEFAULT nextval('public.owner_draws_id_seq');
SELECT setval('public.owner_draws_id_seq', COALESCE((SELECT MAX("id") FROM public."owner_draws"), 1));

-- Table: owner_salary_payment_allocations
CREATE TABLE IF NOT EXISTS public."owner_salary_payment_allocations" (
  "id" bigint PRIMARY KEY,
  "payment_id" bigint NOT NULL,
  "period_id" bigint NOT NULL,
  "amount" numeric NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public."owner_salary_payment_allocations_id_seq";
ALTER TABLE public."owner_salary_payment_allocations" ALTER COLUMN "id" SET DEFAULT nextval('public.owner_salary_payment_allocations_id_seq');
SELECT setval('public.owner_salary_payment_allocations_id_seq', COALESCE((SELECT MAX("id") FROM public."owner_salary_payment_allocations"), 1));

-- Table: owner_salary_payments
CREATE TABLE IF NOT EXISTS public."owner_salary_payments" (
  "id" bigint PRIMARY KEY,
  "profile_id" bigint NOT NULL,
  "payment_date" text NOT NULL,
  "payment_method" text DEFAULT 'cash',
  "payment_reference" text,
  "total_amount" numeric NOT NULL,
  "notes" text,
  "paid_by_user_id" bigint,
  "paid_by_name" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."owner_salary_payments_id_seq";
ALTER TABLE public."owner_salary_payments" ALTER COLUMN "id" SET DEFAULT nextval('public.owner_salary_payments_id_seq');
SELECT setval('public.owner_salary_payments_id_seq', COALESCE((SELECT MAX("id") FROM public."owner_salary_payments"), 1));

-- Table: owner_salary_periods
CREATE TABLE IF NOT EXISTS public."owner_salary_periods" (
  "id" bigint PRIMARY KEY,
  "profile_id" bigint NOT NULL,
  "period_start" text NOT NULL,
  "period_end" text NOT NULL,
  "period_type" text NOT NULL,
  "basic_salary" numeric NOT NULL DEFAULT 0,
  "bonus" numeric DEFAULT 0,
  "allowances" numeric DEFAULT 0,
  "deductions" numeric DEFAULT 0,
  "carried_forward" numeric DEFAULT 0,
  "gross_amount" numeric NOT NULL DEFAULT 0,
  "amount_paid" numeric DEFAULT 0,
  "outstanding_balance" numeric DEFAULT 0,
  "status" text DEFAULT 'unpaid',
  "due_date" text,
  "payslip_number" text,
  "notes" text,
  "created_at" text DEFAULT now(),
  "uif_employee" numeric DEFAULT 0,
  "uif_employer" numeric DEFAULT 0,
  "paye" numeric DEFAULT 0,
  "sdl" numeric DEFAULT 0,
  "draw_deductions" numeric DEFAULT 0,
  "net_pay" numeric DEFAULT 0,
  "deductions_detail" text
);

CREATE SEQUENCE IF NOT EXISTS public."owner_salary_periods_id_seq";
ALTER TABLE public."owner_salary_periods" ALTER COLUMN "id" SET DEFAULT nextval('public.owner_salary_periods_id_seq');
SELECT setval('public.owner_salary_periods_id_seq', COALESCE((SELECT MAX("id") FROM public."owner_salary_periods"), 1));

-- Table: owner_salary_profile
CREATE TABLE IF NOT EXISTS public."owner_salary_profile" (
  "id" bigint PRIMARY KEY,
  "owner_name" text NOT NULL,
  "position" text DEFAULT 'Owner',
  "salary_type" text NOT NULL DEFAULT 'monthly',
  "basic_salary" numeric NOT NULL DEFAULT 0,
  "payment_day" bigint DEFAULT 25,
  "custom_pay_date" text,
  "default_bonus" numeric DEFAULT 0,
  "default_allowances" numeric DEFAULT 0,
  "default_deductions" numeric DEFAULT 0,
  "is_active" bigint DEFAULT 1,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "employee_id" bigint,
  "uif_registration" text,
  "tax_number" text,
  "uif_enabled" bigint DEFAULT 1,
  "paye_enabled" bigint DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."owner_salary_profile_id_seq";
ALTER TABLE public."owner_salary_profile" ALTER COLUMN "id" SET DEFAULT nextval('public.owner_salary_profile_id_seq');
SELECT setval('public.owner_salary_profile_id_seq', COALESCE((SELECT MAX("id") FROM public."owner_salary_profile"), 1));

-- Table: payroll_compliance_submissions
CREATE TABLE IF NOT EXISTS public."payroll_compliance_submissions" (
  "id" bigint PRIMARY KEY,
  "submission_type" text NOT NULL,
  "period_month" text NOT NULL,
  "status" text DEFAULT 'pending',
  "submitted_at" text,
  "submitted_by" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."payroll_compliance_submissions_id_seq";
ALTER TABLE public."payroll_compliance_submissions" ALTER COLUMN "id" SET DEFAULT nextval('public.payroll_compliance_submissions_id_seq');
SELECT setval('public.payroll_compliance_submissions_id_seq', COALESCE((SELECT MAX("id") FROM public."payroll_compliance_submissions"), 1));

-- Table: po_receipt_items
CREATE TABLE IF NOT EXISTS public."po_receipt_items" (
  "id" bigint PRIMARY KEY,
  "receipt_id" bigint NOT NULL,
  "po_item_id" bigint NOT NULL,
  "product_id" bigint,
  "quantity_received" numeric NOT NULL,
  "quantity_backordered" numeric DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."po_receipt_items_id_seq";
ALTER TABLE public."po_receipt_items" ALTER COLUMN "id" SET DEFAULT nextval('public.po_receipt_items_id_seq');
SELECT setval('public.po_receipt_items_id_seq', COALESCE((SELECT MAX("id") FROM public."po_receipt_items"), 1));

-- Table: po_receipts
CREATE TABLE IF NOT EXISTS public."po_receipts" (
  "id" bigint PRIMARY KEY,
  "po_id" bigint NOT NULL,
  "user_id" bigint,
  "received_at" text DEFAULT now(),
  "notes" text
);

CREATE SEQUENCE IF NOT EXISTS public."po_receipts_id_seq";
ALTER TABLE public."po_receipts" ALTER COLUMN "id" SET DEFAULT nextval('public.po_receipts_id_seq');
SELECT setval('public.po_receipts_id_seq', COALESCE((SELECT MAX("id") FROM public."po_receipts"), 1));

-- Table: price_change_history
CREATE TABLE IF NOT EXISTS public."price_change_history" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint NOT NULL,
  "product_name" text NOT NULL,
  "old_price" numeric,
  "new_price" numeric NOT NULL,
  "changed_by" bigint,
  "changed_by_name" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."price_change_history_id_seq";
ALTER TABLE public."price_change_history" ALTER COLUMN "id" SET DEFAULT nextval('public.price_change_history_id_seq');
SELECT setval('public.price_change_history_id_seq', COALESCE((SELECT MAX("id") FROM public."price_change_history"), 1));

-- Table: probation_daily_evaluations
CREATE TABLE IF NOT EXISTS public."probation_daily_evaluations" (
  "id" bigint PRIMARY KEY,
  "probation_id" bigint NOT NULL,
  "employee_id" bigint NOT NULL,
  "eval_date" text NOT NULL,
  "manager_id" bigint,
  "scores_json" jsonb,
  "comments" text,
  "overall_score" numeric,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."probation_daily_evaluations_id_seq";
ALTER TABLE public."probation_daily_evaluations" ALTER COLUMN "id" SET DEFAULT nextval('public.probation_daily_evaluations_id_seq');
SELECT setval('public.probation_daily_evaluations_id_seq', COALESCE((SELECT MAX("id") FROM public."probation_daily_evaluations"), 1));

-- Table: probation_decision_rules
CREATE TABLE IF NOT EXISTS public."probation_decision_rules" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "min_overall_score" numeric DEFAULT 3.5,
  "min_attendance_pct" numeric DEFAULT 90,
  "max_late" bigint DEFAULT 5,
  "max_absences" bigint DEFAULT 2,
  "min_work_quality" numeric DEFAULT 3,
  "is_active" bigint DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."probation_decision_rules_id_seq";
ALTER TABLE public."probation_decision_rules" ALTER COLUMN "id" SET DEFAULT nextval('public.probation_decision_rules_id_seq');
SELECT setval('public.probation_decision_rules_id_seq', COALESCE((SELECT MAX("id") FROM public."probation_decision_rules"), 1));

-- Table: product_conversions
CREATE TABLE IF NOT EXISTS public."product_conversions" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint NOT NULL,
  "from_qty" numeric NOT NULL DEFAULT 1,
  "from_unit" text NOT NULL,
  "to_qty" numeric NOT NULL,
  "to_unit" text NOT NULL,
  "label" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."product_conversions_id_seq";
ALTER TABLE public."product_conversions" ALTER COLUMN "id" SET DEFAULT nextval('public.product_conversions_id_seq');
SELECT setval('public.product_conversions_id_seq', COALESCE((SELECT MAX("id") FROM public."product_conversions"), 1));

-- Table: product_modifiers
CREATE TABLE IF NOT EXISTS public."product_modifiers" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint NOT NULL,
  "name" text NOT NULL,
  "extra_price" numeric DEFAULT 0,
  "modifier_type" text DEFAULT 'extra',
  "option_group" text
);

CREATE SEQUENCE IF NOT EXISTS public."product_modifiers_id_seq";
ALTER TABLE public."product_modifiers" ALTER COLUMN "id" SET DEFAULT nextval('public.product_modifiers_id_seq');
SELECT setval('public.product_modifiers_id_seq', COALESCE((SELECT MAX("id") FROM public."product_modifiers"), 1));

-- Table: product_promo_requests
CREATE TABLE IF NOT EXISTS public."product_promo_requests" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint NOT NULL,
  "proposed_price" numeric NOT NULL,
  "original_price" numeric NOT NULL,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "proposed_by" bigint,
  "approved_by" bigint,
  "notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."product_promo_requests_id_seq";
ALTER TABLE public."product_promo_requests" ALTER COLUMN "id" SET DEFAULT nextval('public.product_promo_requests_id_seq');
SELECT setval('public.product_promo_requests_id_seq', COALESCE((SELECT MAX("id") FROM public."product_promo_requests"), 1));

-- Table: product_recipe_items
CREATE TABLE IF NOT EXISTS public."product_recipe_items" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint NOT NULL,
  "ingredient_product_id" bigint NOT NULL,
  "quantity" numeric NOT NULL,
  "unit" text NOT NULL DEFAULT 'each',
  "waste_pct" numeric DEFAULT 0,
  "sort_order" bigint DEFAULT 0,
  "created_at" text DEFAULT now(),
  "include_rule" text DEFAULT 'always',
  "option_name" text,
  "is_primary" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."product_recipe_items_id_seq";
ALTER TABLE public."product_recipe_items" ALTER COLUMN "id" SET DEFAULT nextval('public.product_recipe_items_id_seq');
SELECT setval('public.product_recipe_items_id_seq', COALESCE((SELECT MAX("id") FROM public."product_recipe_items"), 1));

-- Table: product_variants
CREATE TABLE IF NOT EXISTS public."product_variants" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint NOT NULL,
  "name" text NOT NULL,
  "variant_type" text,
  "selling_price" numeric,
  "barcode" text,
  "stock_quantity" numeric DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."product_variants_id_seq";
ALTER TABLE public."product_variants" ALTER COLUMN "id" SET DEFAULT nextval('public.product_variants_id_seq');
SELECT setval('public.product_variants_id_seq', COALESCE((SELECT MAX("id") FROM public."product_variants"), 1));

-- Table: production_batch_items
CREATE TABLE IF NOT EXISTS public."production_batch_items" (
  "id" bigint PRIMARY KEY,
  "batch_id" bigint NOT NULL,
  "ingredient_product_id" bigint NOT NULL,
  "quantity" numeric NOT NULL,
  "unit" text,
  "unit_cost" numeric DEFAULT 0,
  "line_cost" numeric DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."production_batch_items_id_seq";
ALTER TABLE public."production_batch_items" ALTER COLUMN "id" SET DEFAULT nextval('public.production_batch_items_id_seq');
SELECT setval('public.production_batch_items_id_seq', COALESCE((SELECT MAX("id") FROM public."production_batch_items"), 1));

-- Table: production_batches
CREATE TABLE IF NOT EXISTS public."production_batches" (
  "id" bigint PRIMARY KEY,
  "recipe_profile_id" bigint NOT NULL,
  "product_id" bigint,
  "planned_qty" numeric NOT NULL DEFAULT 1,
  "produced_qty" numeric NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'planned',
  "production_cost" numeric DEFAULT 0,
  "limiting_ingredient" text,
  "max_capacity" numeric,
  "notes" text,
  "branch_id" bigint,
  "created_by" bigint,
  "completed_by" bigint,
  "started_at" text,
  "completed_at" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."production_batches_id_seq";
ALTER TABLE public."production_batches" ALTER COLUMN "id" SET DEFAULT nextval('public.production_batches_id_seq');
SELECT setval('public.production_batches_id_seq', COALESCE((SELECT MAX("id") FROM public."production_batches"), 1));

-- Table: products
CREATE TABLE IF NOT EXISTS public."products" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "category_id" bigint,
  "selling_price" numeric NOT NULL DEFAULT 0,
  "buying_price" numeric DEFAULT 0,
  "barcode" text,
  "sku" text,
  "stock_quantity" numeric DEFAULT 0,
  "min_stock" numeric DEFAULT 5,
  "unit" text DEFAULT 'each',
  "picture_path" text,
  "description" text,
  "is_active" bigint DEFAULT 1,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "brand" text,
  "subcategory" text,
  "supplier_id" bigint,
  "max_stock" numeric,
  "reorder_level" numeric,
  "opening_stock" numeric DEFAULT 0,
  "stock_location" text,
  "batch_number" text,
  "expiry_date" text,
  "item_type" text DEFAULT 'retail',
  "is_archived" bigint DEFAULT 0,
  "qr_code" text,
  "branch_id" bigint DEFAULT 1,
  "requires_options" bigint DEFAULT 0,
  "stock_unit_type" text DEFAULT 'piece',
  "stock_unit" text DEFAULT 'each',
  "purchase_unit" text,
  "purchase_unit_qty" numeric DEFAULT 1,
  "purchase_unit_label" text,
  "recipe_cost" numeric DEFAULT 0,
  "food_cost_pct" numeric DEFAULT 0,
  "gross_profit" numeric DEFAULT 0,
  "profit_margin" numeric DEFAULT 0,
  "alert_out_of_stock" bigint DEFAULT 1,
  "has_recipe" bigint DEFAULT 0,
  "options_style" text DEFAULT 'radio',
  "option_groups_meta" text,
  "promo_flag" bigint DEFAULT 0,
  "promo_notes" text,
  "last_sale_date" text,
  "is_new_arrival" bigint DEFAULT 0,
  "new_arrival_until" text,
  "menu_flags" text,
  "production_mode" text DEFAULT 'make_to_order',
  "available_today" bigint DEFAULT 0,
  "production_capacity" numeric DEFAULT 0,
  "limiting_ingredient_id" bigint,
  "limiting_ingredient_name" text,
  "production_oos" bigint DEFAULT 0,
  "production_oos_reason" text,
  "production_breakdown_json" jsonb,
  "production_capacity_updated_at" text,
  "is_best_seller" bigint DEFAULT 0,
  "show_on_pos" bigint DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."products_id_seq";
ALTER TABLE public."products" ALTER COLUMN "id" SET DEFAULT nextval('public.products_id_seq');
SELECT setval('public.products_id_seq', COALESCE((SELECT MAX("id") FROM public."products"), 1));

-- Table: promotion_flyers
CREATE TABLE IF NOT EXISTS public."promotion_flyers" (
  "id" bigint PRIMARY KEY,
  "flyer_number" text NOT NULL,
  "title" text NOT NULL,
  "promotion_name" text,
  "branch_id" bigint,
  "start_date" text,
  "end_date" text,
  "flyer_size" text DEFAULT 'a4_portrait',
  "status" text DEFAULT 'draft',
  "canvas_json" jsonb,
  "products_json" jsonb,
  "branding_json" jsonb,
  "apply_pos_prices" bigint DEFAULT 0,
  "original_prices_json" jsonb,
  "created_by" bigint,
  "created_by_name" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "approval_status" text DEFAULT 'draft',
  "approved_by" bigint,
  "approved_at" text,
  "rejection_notes" text,
  "pages_json" jsonb,
  "analytics_json" jsonb,
  "submitted_at" text,
  "campaign_goal" text DEFAULT 'all',
  "go_live_mode" text DEFAULT 'both',
  "auto_go_live" bigint DEFAULT 1,
  "ended_at" text,
  "live_at" text
);

CREATE SEQUENCE IF NOT EXISTS public."promotion_flyers_id_seq";
ALTER TABLE public."promotion_flyers" ALTER COLUMN "id" SET DEFAULT nextval('public.promotion_flyers_id_seq');
SELECT setval('public.promotion_flyers_id_seq', COALESCE((SELECT MAX("id") FROM public."promotion_flyers"), 1));

-- Table: purchase_order_items
CREATE TABLE IF NOT EXISTS public."purchase_order_items" (
  "id" bigint PRIMARY KEY,
  "purchase_order_id" bigint NOT NULL,
  "product_id" bigint,
  "product_name" text NOT NULL,
  "quantity" numeric NOT NULL,
  "buying_price" numeric NOT NULL,
  "total" numeric NOT NULL,
  "received_qty" numeric DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."purchase_order_items_id_seq";
ALTER TABLE public."purchase_order_items" ALTER COLUMN "id" SET DEFAULT nextval('public.purchase_order_items_id_seq');
SELECT setval('public.purchase_order_items_id_seq', COALESCE((SELECT MAX("id") FROM public."purchase_order_items"), 1));

-- Table: purchase_orders
CREATE TABLE IF NOT EXISTS public."purchase_orders" (
  "id" bigint PRIMARY KEY,
  "po_number" text NOT NULL,
  "supplier_id" bigint,
  "user_id" bigint,
  "total" numeric DEFAULT 0,
  "status" text DEFAULT 'pending',
  "receiving_date" text,
  "notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."purchase_orders_id_seq";
ALTER TABLE public."purchase_orders" ALTER COLUMN "id" SET DEFAULT nextval('public.purchase_orders_id_seq');
SELECT setval('public.purchase_orders_id_seq', COALESCE((SELECT MAX("id") FROM public."purchase_orders"), 1));

-- Table: quote_counter
CREATE TABLE IF NOT EXISTS public."quote_counter" (
  "id" bigint PRIMARY KEY,
  "last_number" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."quote_counter_id_seq";
ALTER TABLE public."quote_counter" ALTER COLUMN "id" SET DEFAULT nextval('public.quote_counter_id_seq');
SELECT setval('public.quote_counter_id_seq', COALESCE((SELECT MAX("id") FROM public."quote_counter"), 1));

-- Table: quote_items
CREATE TABLE IF NOT EXISTS public."quote_items" (
  "id" bigint PRIMARY KEY,
  "quote_id" bigint NOT NULL,
  "product_id" bigint,
  "product_name" text NOT NULL,
  "quantity" numeric NOT NULL,
  "unit_price" numeric NOT NULL,
  "discount" numeric DEFAULT 0,
  "total" numeric NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public."quote_items_id_seq";
ALTER TABLE public."quote_items" ALTER COLUMN "id" SET DEFAULT nextval('public.quote_items_id_seq');
SELECT setval('public.quote_items_id_seq', COALESCE((SELECT MAX("id") FROM public."quote_items"), 1));

-- Table: quotes
CREATE TABLE IF NOT EXISTS public."quotes" (
  "id" bigint PRIMARY KEY,
  "quote_number" text NOT NULL,
  "customer_id" bigint,
  "user_id" bigint,
  "branch_id" bigint DEFAULT 1,
  "subtotal" numeric DEFAULT 0,
  "discount" numeric DEFAULT 0,
  "tax_amount" numeric DEFAULT 0,
  "total" numeric DEFAULT 0,
  "status" text DEFAULT 'open',
  "valid_until" text,
  "expires_at" text,
  "notes" text,
  "created_at" text DEFAULT now(),
  "converted_sale_id" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."quotes_id_seq";
ALTER TABLE public."quotes" ALTER COLUMN "id" SET DEFAULT nextval('public.quotes_id_seq');
SELECT setval('public.quotes_id_seq', COALESCE((SELECT MAX("id") FROM public."quotes"), 1));

-- Table: receipt_counter
CREATE TABLE IF NOT EXISTS public."receipt_counter" (
  "id" bigint PRIMARY KEY,
  "last_number" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."receipt_counter_id_seq";
ALTER TABLE public."receipt_counter" ALTER COLUMN "id" SET DEFAULT nextval('public.receipt_counter_id_seq');
SELECT setval('public.receipt_counter_id_seq', COALESCE((SELECT MAX("id") FROM public."receipt_counter"), 1));

-- Table: recipe_activity_log
CREATE TABLE IF NOT EXISTS public."recipe_activity_log" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint,
  "user_name" text,
  "action" text NOT NULL,
  "entity_type" text,
  "entity_id" bigint,
  "old_value" text,
  "new_value" text,
  "branch_id" bigint,
  "device_id" text,
  "ip_address" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."recipe_activity_log_id_seq";
ALTER TABLE public."recipe_activity_log" ALTER COLUMN "id" SET DEFAULT nextval('public.recipe_activity_log_id_seq');
SELECT setval('public.recipe_activity_log_id_seq', COALESCE((SELECT MAX("id") FROM public."recipe_activity_log"), 1));

-- Table: recipe_profiles
CREATE TABLE IF NOT EXISTS public."recipe_profiles" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint,
  "name" text NOT NULL,
  "category" text,
  "description" text,
  "prep_time_minutes" bigint DEFAULT 0,
  "cook_time_minutes" bigint DEFAULT 0,
  "serving_size" numeric DEFAULT 1,
  "yield_qty" numeric DEFAULT 1,
  "yield_unit" text DEFAULT 'portion',
  "image_path" text,
  "instructions" text,
  "video_url" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'draft',
  "version" bigint NOT NULL DEFAULT 1,
  "production_mode" text NOT NULL DEFAULT 'make_to_order',
  "price_mode" text DEFAULT 'profit_pct',
  "target_profit_pct" numeric DEFAULT 40,
  "suggested_price" numeric DEFAULT 0,
  "override_price" numeric,
  "selling_price" numeric DEFAULT 0,
  "recipe_cost" numeric DEFAULT 0,
  "food_cost_pct" numeric DEFAULT 0,
  "gross_profit" numeric DEFAULT 0,
  "profit_margin" numeric DEFAULT 0,
  "available_today" bigint DEFAULT 0,
  "new_arrival_days" bigint DEFAULT 14,
  "new_arrival_until" text,
  "branch_id" bigint,
  "rejection_notes" text,
  "created_by" bigint,
  "updated_by" bigint,
  "approved_by" bigint,
  "approved_at" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."recipe_profiles_id_seq";
ALTER TABLE public."recipe_profiles" ALTER COLUMN "id" SET DEFAULT nextval('public.recipe_profiles_id_seq');
SELECT setval('public.recipe_profiles_id_seq', COALESCE((SELECT MAX("id") FROM public."recipe_profiles"), 1));

-- Table: recipe_promotions
CREATE TABLE IF NOT EXISTS public."recipe_promotions" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "promo_type" text NOT NULL,
  "discount_value" numeric DEFAULT 0,
  "start_date" text,
  "end_date" text,
  "start_time" text,
  "end_time" text,
  "product_ids_json" jsonb,
  "recipe_ids_json" jsonb,
  "branch_ids_json" jsonb,
  "customer_groups_json" jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."recipe_promotions_id_seq";
ALTER TABLE public."recipe_promotions" ALTER COLUMN "id" SET DEFAULT nextval('public.recipe_promotions_id_seq');
SELECT setval('public.recipe_promotions_id_seq', COALESCE((SELECT MAX("id") FROM public."recipe_promotions"), 1));

-- Table: recipe_substitutions
CREATE TABLE IF NOT EXISTS public."recipe_substitutions" (
  "id" bigint PRIMARY KEY,
  "recipe_profile_id" bigint,
  "from_product_id" bigint NOT NULL,
  "to_product_id" bigint NOT NULL,
  "quantity" numeric,
  "unit" text,
  "reason" text,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_by" bigint,
  "approved_by" bigint,
  "approved_at" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."recipe_substitutions_id_seq";
ALTER TABLE public."recipe_substitutions" ALTER COLUMN "id" SET DEFAULT nextval('public.recipe_substitutions_id_seq');
SELECT setval('public.recipe_substitutions_id_seq', COALESCE((SELECT MAX("id") FROM public."recipe_substitutions"), 1));

-- Table: recipe_user_access
CREATE TABLE IF NOT EXISTS public."recipe_user_access" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint NOT NULL,
  "recipe_role" text NOT NULL DEFAULT 'viewer',
  "enabled" bigint NOT NULL DEFAULT 1,
  "granted_by" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."recipe_user_access_id_seq";
ALTER TABLE public."recipe_user_access" ALTER COLUMN "id" SET DEFAULT nextval('public.recipe_user_access_id_seq');
SELECT setval('public.recipe_user_access_id_seq', COALESCE((SELECT MAX("id") FROM public."recipe_user_access"), 1));

-- Table: recipe_versions
CREATE TABLE IF NOT EXISTS public."recipe_versions" (
  "id" bigint PRIMARY KEY,
  "recipe_profile_id" bigint NOT NULL,
  "version" bigint NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "recipe_cost" numeric,
  "selling_price" numeric,
  "changed_by" bigint,
  "change_notes" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."recipe_versions_id_seq";
ALTER TABLE public."recipe_versions" ALTER COLUMN "id" SET DEFAULT nextval('public.recipe_versions_id_seq');
SELECT setval('public.recipe_versions_id_seq', COALESCE((SELECT MAX("id") FROM public."recipe_versions"), 1));

-- Table: recipe_waste_logs
CREATE TABLE IF NOT EXISTS public."recipe_waste_logs" (
  "id" bigint PRIMARY KEY,
  "waste_type" text NOT NULL,
  "product_id" bigint,
  "recipe_profile_id" bigint,
  "quantity" numeric NOT NULL,
  "unit" text,
  "cost" numeric DEFAULT 0,
  "reason" text,
  "status" text NOT NULL DEFAULT 'pending',
  "recorded_by" bigint,
  "approved_by" bigint,
  "approved_at" text,
  "branch_id" bigint,
  "created_at" text DEFAULT now(),
  "photo_path" text
);

CREATE SEQUENCE IF NOT EXISTS public."recipe_waste_logs_id_seq";
ALTER TABLE public."recipe_waste_logs" ALTER COLUMN "id" SET DEFAULT nextval('public.recipe_waste_logs_id_seq');
SELECT setval('public.recipe_waste_logs_id_seq', COALESCE((SELECT MAX("id") FROM public."recipe_waste_logs"), 1));

-- Table: restaurant_tables
CREATE TABLE IF NOT EXISTS public."restaurant_tables" (
  "id" bigint PRIMARY KEY,
  "table_number" text NOT NULL,
  "seats" bigint DEFAULT 4,
  "status" text DEFAULT 'available',
  "waiter_id" bigint,
  "branch_id" bigint DEFAULT 1,
  "notes" text
);

CREATE SEQUENCE IF NOT EXISTS public."restaurant_tables_id_seq";
ALTER TABLE public."restaurant_tables" ALTER COLUMN "id" SET DEFAULT nextval('public.restaurant_tables_id_seq');
SELECT setval('public.restaurant_tables_id_seq', COALESCE((SELECT MAX("id") FROM public."restaurant_tables"), 1));

-- Table: return_counter
CREATE TABLE IF NOT EXISTS public."return_counter" (
  "id" bigint PRIMARY KEY,
  "last_number" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."return_counter_id_seq";
ALTER TABLE public."return_counter" ALTER COLUMN "id" SET DEFAULT nextval('public.return_counter_id_seq');
SELECT setval('public.return_counter_id_seq', COALESCE((SELECT MAX("id") FROM public."return_counter"), 1));

-- Table: return_items
CREATE TABLE IF NOT EXISTS public."return_items" (
  "id" bigint PRIMARY KEY,
  "return_id" bigint NOT NULL,
  "product_id" bigint,
  "product_name" text NOT NULL,
  "quantity" numeric NOT NULL,
  "unit_price" numeric NOT NULL,
  "total" numeric NOT NULL,
  "sale_item_id" bigint,
  "combo_id" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."return_items_id_seq";
ALTER TABLE public."return_items" ALTER COLUMN "id" SET DEFAULT nextval('public.return_items_id_seq');
SELECT setval('public.return_items_id_seq', COALESCE((SELECT MAX("id") FROM public."return_items"), 1));

-- Table: returns
CREATE TABLE IF NOT EXISTS public."returns" (
  "id" bigint PRIMARY KEY,
  "sale_id" bigint,
  "receipt_number" text,
  "user_id" bigint,
  "return_type" text,
  "reason" text,
  "total_refund" numeric DEFAULT 0,
  "created_at" text DEFAULT now(),
  "return_number" text,
  "approved_by" bigint,
  "approved_by_name" text,
  "return_to_stock" bigint DEFAULT 1,
  "stock_reason" text,
  "status" text DEFAULT 'completed',
  "customer_id" bigint,
  "refund_method" text DEFAULT 'cash'
);

CREATE SEQUENCE IF NOT EXISTS public."returns_id_seq";
ALTER TABLE public."returns" ALTER COLUMN "id" SET DEFAULT nextval('public.returns_id_seq');
SELECT setval('public.returns_id_seq', COALESCE((SELECT MAX("id") FROM public."returns"), 1));

-- Table: sale_items
CREATE TABLE IF NOT EXISTS public."sale_items" (
  "id" bigint PRIMARY KEY,
  "sale_id" bigint NOT NULL,
  "product_id" bigint,
  "product_name" text NOT NULL,
  "quantity" numeric NOT NULL DEFAULT 1,
  "unit_price" numeric NOT NULL,
  "buying_price" numeric DEFAULT 0,
  "discount" numeric DEFAULT 0,
  "total" numeric NOT NULL,
  "item_type" text,
  "modifiers_text" text,
  "combo_id" bigint,
  "original_unit_price" numeric,
  "promo_request_id" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."sale_items_id_seq";
ALTER TABLE public."sale_items" ALTER COLUMN "id" SET DEFAULT nextval('public.sale_items_id_seq');
SELECT setval('public.sale_items_id_seq', COALESCE((SELECT MAX("id") FROM public."sale_items"), 1));

-- Table: sale_payments
CREATE TABLE IF NOT EXISTS public."sale_payments" (
  "id" bigint PRIMARY KEY,
  "sale_id" bigint NOT NULL,
  "payment_type" text NOT NULL,
  "amount" numeric NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public."sale_payments_id_seq";
ALTER TABLE public."sale_payments" ALTER COLUMN "id" SET DEFAULT nextval('public.sale_payments_id_seq');
SELECT setval('public.sale_payments_id_seq', COALESCE((SELECT MAX("id") FROM public."sale_payments"), 1));

-- Table: sales
CREATE TABLE IF NOT EXISTS public."sales" (
  "id" bigint PRIMARY KEY,
  "receipt_number" text NOT NULL,
  "user_id" bigint,
  "customer_id" bigint,
  "subtotal" numeric NOT NULL DEFAULT 0,
  "discount" numeric DEFAULT 0,
  "tax_amount" numeric DEFAULT 0,
  "total" numeric NOT NULL DEFAULT 0,
  "amount_paid" numeric DEFAULT 0,
  "change_amount" numeric DEFAULT 0,
  "status" text DEFAULT 'completed',
  "notes" text,
  "created_at" text DEFAULT now(),
  "branch_id" bigint DEFAULT 1,
  "device_id" text,
  "void_reason" text,
  "order_type" text,
  "table_id" bigint,
  "table_name" text,
  "order_number" text,
  "delivery_address" text
);

CREATE SEQUENCE IF NOT EXISTS public."sales_id_seq";
ALTER TABLE public."sales" ALTER COLUMN "id" SET DEFAULT nextval('public.sales_id_seq');
SELECT setval('public.sales_id_seq', COALESCE((SELECT MAX("id") FROM public."sales"), 1));

-- Table: schema_version
CREATE TABLE IF NOT EXISTS public."schema_version" (
  "version" bigint PRIMARY KEY
);

CREATE SEQUENCE IF NOT EXISTS public."schema_version_version_seq";
ALTER TABLE public."schema_version" ALTER COLUMN "version" SET DEFAULT nextval('public.schema_version_version_seq');
SELECT setval('public.schema_version_version_seq', COALESCE((SELECT MAX("version") FROM public."schema_version"), 1));

-- Table: settings_change_requests
CREATE TABLE IF NOT EXISTS public."settings_change_requests" (
  "id" bigint PRIMARY KEY,
  "requested_by" bigint NOT NULL,
  "requested_by_name" text,
  "settings_json" jsonb NOT NULL,
  "status" text DEFAULT 'pending',
  "reviewed_by" bigint,
  "reviewed_by_name" text,
  "review_notes" text,
  "created_at" text DEFAULT now(),
  "reviewed_at" text
);

CREATE SEQUENCE IF NOT EXISTS public."settings_change_requests_id_seq";
ALTER TABLE public."settings_change_requests" ALTER COLUMN "id" SET DEFAULT nextval('public.settings_change_requests_id_seq');
SELECT setval('public.settings_change_requests_id_seq', COALESCE((SELECT MAX("id") FROM public."settings_change_requests"), 1));

-- Table: shifts
CREATE TABLE IF NOT EXISTS public."shifts" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint,
  "opened_at" text DEFAULT now(),
  "closed_at" text,
  "opening_float" numeric DEFAULT 0,
  "closing_balance" numeric DEFAULT 0,
  "cash_counted" numeric DEFAULT 0,
  "expected_cash" numeric DEFAULT 0,
  "cash_difference" numeric DEFAULT 0,
  "total_sales" numeric DEFAULT 0,
  "total_cash" numeric DEFAULT 0,
  "total_card" numeric DEFAULT 0,
  "total_eft" numeric DEFAULT 0,
  "total_mobile" numeric DEFAULT 0,
  "customer_count" bigint DEFAULT 0,
  "status" text DEFAULT 'open',
  "notes" text,
  "branch_id" bigint DEFAULT 1,
  "mobile_sales" numeric DEFAULT 0,
  "other_sales" numeric DEFAULT 0,
  "giftcard_sales" numeric DEFAULT 0,
  "account_sales" numeric DEFAULT 0,
  "actual_payments_json" jsonb,
  "payment_shortages_json" jsonb,
  "daily_target" numeric DEFAULT 0,
  "sales_at_close" numeric DEFAULT 0,
  "target_remaining" numeric DEFAULT 0,
  "target_met" bigint DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public."shifts_id_seq";
ALTER TABLE public."shifts" ALTER COLUMN "id" SET DEFAULT nextval('public.shifts_id_seq');
SELECT setval('public.shifts_id_seq', COALESCE((SELECT MAX("id") FROM public."shifts"), 1));

-- Table: shop_operating_log
CREATE TABLE IF NOT EXISTS public."shop_operating_log" (
  "id" bigint PRIMARY KEY,
  "event_type" text NOT NULL,
  "user_id" bigint,
  "username" text,
  "full_name" text,
  "notes" text,
  "event_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."shop_operating_log_id_seq";
ALTER TABLE public."shop_operating_log" ALTER COLUMN "id" SET DEFAULT nextval('public.shop_operating_log_id_seq');
SELECT setval('public.shop_operating_log_id_seq', COALESCE((SELECT MAX("id") FROM public."shop_operating_log"), 1));

-- Table: shop_settings
CREATE TABLE IF NOT EXISTS public."shop_settings" (
  "id" bigint PRIMARY KEY,
  "shop_name" text NOT NULL DEFAULT 'My Shop',
  "logo_path" text,
  "address" text,
  "phone" text,
  "currency" text NOT NULL DEFAULT 'R',
  "receipt_footer" text DEFAULT 'Thank you for your purchase!',
  "tax_rate" numeric DEFAULT 0,
  "tax_enabled" bigint DEFAULT 0,
  "receipt_width" bigint DEFAULT 80,
  "theme" text DEFAULT 'light',
  "language" text DEFAULT 'en',
  "setup_complete" bigint DEFAULT 0,
  "license_expiry" text,
  "last_backup" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "email" text,
  "website" text,
  "vat_number" text,
  "social_media" text,
  "return_policy" text,
  "thank_you_message" text,
  "business_type" text DEFAULT 'retail',
  "currency_name" text DEFAULT 'Rand',
  "decimal_places" bigint DEFAULT 2,
  "thousands_sep" text DEFAULT ',',
  "tax_inclusive" bigint DEFAULT 0,
  "printer_settings" jsonb DEFAULT '{}',
  "receipt_design" text DEFAULT '{}',
  "security_settings" jsonb DEFAULT '{}',
  "customization" text DEFAULT '{}',
  "device_settings" jsonb DEFAULT '{}',
  "discount_settings" jsonb DEFAULT '{}',
  "backup_settings" jsonb DEFAULT '{}',
  "branch_id" bigint DEFAULT 1,
  "date_format" text DEFAULT 'DD/MM/YYYY',
  "time_format" text DEFAULT '24h',
  "invoice_prefix" text DEFAULT 'INV',
  "quote_prefix" text DEFAULT 'QT',
  "automation_settings" jsonb DEFAULT '[]',
  "format_settings" jsonb DEFAULT '{}',
  "license_settings" jsonb DEFAULT '{}',
  "scanner_settings" jsonb DEFAULT '{}',
  "loyalty_settings" jsonb,
  "payment_settings" jsonb,
  "account_settings" jsonb,
  "operating_hours_settings" jsonb DEFAULT '{}',
  "payroll_settings" jsonb DEFAULT '{}',
  "notification_settings" jsonb DEFAULT '{}',
  "staff_portal_settings" jsonb DEFAULT '{}',
  "sync_settings" jsonb DEFAULT '{}',
  "receipt_prefix" text DEFAULT 'RCP',
  "whatsapp_settings" jsonb,
  "sales_targets" text DEFAULT '{}',
  "marketing_brand_kit" text DEFAULT '{}',
  "shift_settings" jsonb DEFAULT '{}',
  "admin_signature_path" text,
  "quote_expiry_hours" bigint DEFAULT 168,
  "quote_expiry_unit" text DEFAULT 'hours',
  "kds_notification_sound" text,
  "checklist_settings" jsonb,
  "gift_card_settings" jsonb,
  "layby_settings" jsonb,
  "app_display_name" text,
  "eom_settings" jsonb,
  "account_settings_v2" jsonb,
  "recruitment_settings" jsonb
);

CREATE SEQUENCE IF NOT EXISTS public."shop_settings_id_seq";
ALTER TABLE public."shop_settings" ALTER COLUMN "id" SET DEFAULT nextval('public.shop_settings_id_seq');
SELECT setval('public.shop_settings_id_seq', COALESCE((SELECT MAX("id") FROM public."shop_settings"), 1));

-- Table: staff_login_selfies
CREATE TABLE IF NOT EXISTS public."staff_login_selfies" (
  "id" bigint PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "photo_data" text NOT NULL,
  "login_date" text NOT NULL,
  "login_at" text DEFAULT now(),
  "device_info" text,
  "is_edited" bigint DEFAULT 0,
  "edited_at" text,
  "edited_by" bigint,
  "edited_by_name" text,
  "edit_notes" text,
  "original_photo_data" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."staff_login_selfies_id_seq";
ALTER TABLE public."staff_login_selfies" ALTER COLUMN "id" SET DEFAULT nextval('public.staff_login_selfies_id_seq');
SELECT setval('public.staff_login_selfies_id_seq', COALESCE((SELECT MAX("id") FROM public."staff_login_selfies"), 1));

-- Table: stock_count_lines
CREATE TABLE IF NOT EXISTS public."stock_count_lines" (
  "id" bigint PRIMARY KEY,
  "count_id" bigint NOT NULL,
  "product_id" bigint NOT NULL,
  "system_qty" numeric NOT NULL,
  "counted_qty" numeric NOT NULL,
  "difference" numeric NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public."stock_count_lines_id_seq";
ALTER TABLE public."stock_count_lines" ALTER COLUMN "id" SET DEFAULT nextval('public.stock_count_lines_id_seq');
SELECT setval('public.stock_count_lines_id_seq', COALESCE((SELECT MAX("id") FROM public."stock_count_lines"), 1));

-- Table: stock_counts
CREATE TABLE IF NOT EXISTS public."stock_counts" (
  "id" bigint PRIMARY KEY,
  "count_number" text NOT NULL,
  "user_id" bigint,
  "branch_id" bigint DEFAULT 1,
  "status" text DEFAULT 'open',
  "notes" text,
  "created_at" text DEFAULT now(),
  "completed_at" text
);

CREATE SEQUENCE IF NOT EXISTS public."stock_counts_id_seq";
ALTER TABLE public."stock_counts" ALTER COLUMN "id" SET DEFAULT nextval('public.stock_counts_id_seq');
SELECT setval('public.stock_counts_id_seq', COALESCE((SELECT MAX("id") FROM public."stock_counts"), 1));

-- Table: stock_movements
CREATE TABLE IF NOT EXISTS public."stock_movements" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint NOT NULL,
  "movement_type" text NOT NULL,
  "quantity" numeric NOT NULL,
  "previous_stock" numeric,
  "new_stock" numeric,
  "reference_type" text,
  "reference_id" bigint,
  "notes" text,
  "user_id" bigint,
  "created_at" text DEFAULT now(),
  "branch_id" bigint DEFAULT 1
);

CREATE SEQUENCE IF NOT EXISTS public."stock_movements_id_seq";
ALTER TABLE public."stock_movements" ALTER COLUMN "id" SET DEFAULT nextval('public.stock_movements_id_seq');
SELECT setval('public.stock_movements_id_seq', COALESCE((SELECT MAX("id") FROM public."stock_movements"), 1));

-- Table: supervisor_codes
CREATE TABLE IF NOT EXISTS public."supervisor_codes" (
  "id" bigint PRIMARY KEY,
  "code" text NOT NULL,
  "code_date" text NOT NULL,
  "purpose" text DEFAULT 'void',
  "created_by" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."supervisor_codes_id_seq";
ALTER TABLE public."supervisor_codes" ALTER COLUMN "id" SET DEFAULT nextval('public.supervisor_codes_id_seq');
SELECT setval('public.supervisor_codes_id_seq', COALESCE((SELECT MAX("id") FROM public."supervisor_codes"), 1));

-- Table: supplier_payments
CREATE TABLE IF NOT EXISTS public."supplier_payments" (
  "id" bigint PRIMARY KEY,
  "supplier_id" bigint NOT NULL,
  "payment_number" text NOT NULL,
  "amount" numeric NOT NULL,
  "payment_method" text DEFAULT 'cash',
  "notes" text,
  "user_id" bigint,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."supplier_payments_id_seq";
ALTER TABLE public."supplier_payments" ALTER COLUMN "id" SET DEFAULT nextval('public.supplier_payments_id_seq');
SELECT setval('public.supplier_payments_id_seq', COALESCE((SELECT MAX("id") FROM public."supplier_payments"), 1));

-- Table: supplier_products
CREATE TABLE IF NOT EXISTS public."supplier_products" (
  "id" bigint PRIMARY KEY,
  "supplier_id" bigint NOT NULL,
  "product_id" bigint NOT NULL,
  "buying_price" numeric
);

CREATE SEQUENCE IF NOT EXISTS public."supplier_products_id_seq";
ALTER TABLE public."supplier_products" ALTER COLUMN "id" SET DEFAULT nextval('public.supplier_products_id_seq');
SELECT setval('public.supplier_products_id_seq', COALESCE((SELECT MAX("id") FROM public."supplier_products"), 1));

-- Table: suppliers
CREATE TABLE IF NOT EXISTS public."suppliers" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "address" text,
  "balance_owed" numeric DEFAULT 0,
  "notes" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now(),
  "bank_name" text,
  "bank_account_name" text,
  "bank_account_number" text,
  "bank_branch_code" text
);

CREATE SEQUENCE IF NOT EXISTS public."suppliers_id_seq";
ALTER TABLE public."suppliers" ALTER COLUMN "id" SET DEFAULT nextval('public.suppliers_id_seq');
SELECT setval('public.suppliers_id_seq', COALESCE((SELECT MAX("id") FROM public."suppliers"), 1));

-- Archived (online ordering / hub sync removed from product): sync_outbox → legacy_sync_outbox
CREATE TABLE IF NOT EXISTS public."legacy_sync_outbox" (
  "id" bigint PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_id" bigint,
  "payload" text NOT NULL,
  "created_at" text DEFAULT now(),
  "synced_at" text,
  "error" text
);

CREATE SEQUENCE IF NOT EXISTS public."legacy_sync_outbox_id_seq";
ALTER TABLE public."legacy_sync_outbox" ALTER COLUMN "id" SET DEFAULT nextval('public.legacy_sync_outbox_id_seq');
SELECT setval('public.legacy_sync_outbox_id_seq', COALESCE((SELECT MAX("id") FROM public."legacy_sync_outbox"), 1));

-- Table: system_logs
CREATE TABLE IF NOT EXISTS public."system_logs" (
  "id" bigint PRIMARY KEY,
  "level" text DEFAULT 'info',
  "source" text,
  "message" text NOT NULL,
  "details" text,
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."system_logs_id_seq";
ALTER TABLE public."system_logs" ALTER COLUMN "id" SET DEFAULT nextval('public.system_logs_id_seq');
SELECT setval('public.system_logs_id_seq', COALESCE((SELECT MAX("id") FROM public."system_logs"), 1));

-- Table: user_login_events
CREATE TABLE IF NOT EXISTS public."user_login_events" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint NOT NULL,
  "username" text,
  "full_name" text,
  "event_type" text NOT NULL,
  "event_at" text DEFAULT now(),
  "scheduled_start" text,
  "scheduled_end" text,
  "late_minutes" bigint DEFAULT 0,
  "early_minutes" bigint DEFAULT 0,
  "notes" text
);

CREATE SEQUENCE IF NOT EXISTS public."user_login_events_id_seq";
ALTER TABLE public."user_login_events" ALTER COLUMN "id" SET DEFAULT nextval('public.user_login_events_id_seq');
SELECT setval('public.user_login_events_id_seq', COALESCE((SELECT MAX("id") FROM public."user_login_events"), 1));

-- Table: users
CREATE TABLE IF NOT EXISTS public."users" (
  "id" bigint PRIMARY KEY,
  "username" text NOT NULL,
  "password_hash" text NOT NULL,
  "pin" text,
  "full_name" text NOT NULL,
  "role" text NOT NULL,
  "is_active" bigint DEFAULT 1,
  "permissions" jsonb DEFAULT '{}',
  "branch_id" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."users_id_seq";
ALTER TABLE public."users" ALTER COLUMN "id" SET DEFAULT nextval('public.users_id_seq');
SELECT setval('public.users_id_seq', COALESCE((SELECT MAX("id") FROM public."users"), 1));

-- Table: waste_records
CREATE TABLE IF NOT EXISTS public."waste_records" (
  "id" bigint PRIMARY KEY,
  "product_id" bigint NOT NULL,
  "quantity" numeric NOT NULL,
  "reason" text NOT NULL,
  "employee_id" bigint,
  "branch_id" bigint DEFAULT 1,
  "notes" text,
  "cost_value" numeric DEFAULT 0,
  "created_at" text DEFAULT now(),
  "status" text DEFAULT 'pending',
  "photo_path_1" text,
  "photo_path_2" text,
  "approved_by" bigint,
  "approved_at" text,
  "rejection_notes" text,
  "returned_to_stock" bigint DEFAULT 0,
  "returned_at" text,
  "returned_by" bigint
);

CREATE SEQUENCE IF NOT EXISTS public."waste_records_id_seq";
ALTER TABLE public."waste_records" ALTER COLUMN "id" SET DEFAULT nextval('public.waste_records_id_seq');
SELECT setval('public.waste_records_id_seq', COALESCE((SELECT MAX("id") FROM public."waste_records"), 1));

-- Table: whatsapp_campaigns
CREATE TABLE IF NOT EXISTS public."whatsapp_campaigns" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "template_id" bigint,
  "audience_filter" text NOT NULL,
  "audience_json" jsonb,
  "scheduled_at" text,
  "status" text DEFAULT 'draft',
  "sent_count" bigint DEFAULT 0,
  "branch_id" bigint,
  "created_by" bigint,
  "created_by_name" text,
  "sent_at" text,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."whatsapp_campaigns_id_seq";
ALTER TABLE public."whatsapp_campaigns" ALTER COLUMN "id" SET DEFAULT nextval('public.whatsapp_campaigns_id_seq');
SELECT setval('public.whatsapp_campaigns_id_seq', COALESCE((SELECT MAX("id") FROM public."whatsapp_campaigns"), 1));

-- Table: whatsapp_messages
CREATE TABLE IF NOT EXISTS public."whatsapp_messages" (
  "id" bigint PRIMARY KEY,
  "recipient_type" text NOT NULL,
  "recipient_id" bigint,
  "recipient_name" text,
  "phone" text NOT NULL,
  "message_type" text NOT NULL,
  "template_id" bigint,
  "campaign_id" bigint,
  "body" text NOT NULL,
  "status" text DEFAULT 'pending',
  "sender_id" bigint,
  "sender_name" text,
  "branch_id" bigint,
  "sale_id" bigint,
  "metadata_json" jsonb,
  "sent_at" text DEFAULT now(),
  "created_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."whatsapp_messages_id_seq";
ALTER TABLE public."whatsapp_messages" ALTER COLUMN "id" SET DEFAULT nextval('public.whatsapp_messages_id_seq');
SELECT setval('public.whatsapp_messages_id_seq', COALESCE((SELECT MAX("id") FROM public."whatsapp_messages"), 1));

-- Table: whatsapp_templates
CREATE TABLE IF NOT EXISTS public."whatsapp_templates" (
  "id" bigint PRIMARY KEY,
  "slug" text,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "body" text NOT NULL,
  "is_builtin" bigint DEFAULT 0,
  "is_active" bigint DEFAULT 1,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."whatsapp_templates_id_seq";
ALTER TABLE public."whatsapp_templates" ALTER COLUMN "id" SET DEFAULT nextval('public.whatsapp_templates_id_seq');
SELECT setval('public.whatsapp_templates_id_seq', COALESCE((SELECT MAX("id") FROM public."whatsapp_templates"), 1));

-- Table: whatsapp_templates_v59
CREATE TABLE IF NOT EXISTS public."whatsapp_templates_v59" (
  "id" bigint PRIMARY KEY,
  "slug" text,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "body" text NOT NULL,
  "is_builtin" bigint DEFAULT 0,
  "is_active" bigint DEFAULT 1,
  "created_by" bigint,
  "created_at" text DEFAULT now(),
  "updated_at" text DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public."whatsapp_templates_v59_id_seq";
ALTER TABLE public."whatsapp_templates_v59" ALTER COLUMN "id" SET DEFAULT nextval('public.whatsapp_templates_v59_id_seq');
SELECT setval('public.whatsapp_templates_v59_id_seq', COALESCE((SELECT MAX("id") FROM public."whatsapp_templates_v59"), 1));

-- Foreign keys (additive, idempotent)
DO $$ BEGIN
  ALTER TABLE public."attendance_penalties" ADD CONSTRAINT "attendance_penalties_fk_0"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."attendance_penalties" ADD CONSTRAINT "attendance_penalties_fk_1"
    FOREIGN KEY ("attendance_id") REFERENCES public."employee_attendance"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."attendance_penalties" ADD CONSTRAINT "attendance_penalties_fk_2"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."audit_log" ADD CONSTRAINT "audit_log_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."cash_drawer_log" ADD CONSTRAINT "cash_drawer_log_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."cash_drops" ADD CONSTRAINT "cash_drops_fk_0"
    FOREIGN KEY ("shift_id") REFERENCES public."shifts"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."cashout_penalties" ADD CONSTRAINT "cashout_penalties_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."cashout_penalties" ADD CONSTRAINT "cashout_penalties_fk_1"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."cashup_sessions" ADD CONSTRAINT "cashup_sessions_fk_0"
    FOREIGN KEY ("shift_id") REFERENCES public."shifts"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."closing_checklist_templates" ADD CONSTRAINT "closing_checklist_templates_fk_0"
    FOREIGN KEY ("assigned_employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."closing_checklist_templates" ADD CONSTRAINT "closing_checklist_templates_fk_1"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."combo_items" ADD CONSTRAINT "combo_items_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."combo_items" ADD CONSTRAINT "combo_items_fk_1"
    FOREIGN KEY ("combo_id") REFERENCES public."combos"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."combo_sale_log" ADD CONSTRAINT "combo_sale_log_fk_0"
    FOREIGN KEY ("sale_id") REFERENCES public."sales"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."combo_sale_log" ADD CONSTRAINT "combo_sale_log_fk_1"
    FOREIGN KEY ("combo_id") REFERENCES public."combos"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."company_rule_history" ADD CONSTRAINT "company_rule_history_fk_0"
    FOREIGN KEY ("rule_id") REFERENCES public."company_rules"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."custom_field_values" ADD CONSTRAINT "custom_field_values_fk_0"
    FOREIGN KEY ("field_id") REFERENCES public."custom_fields"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."customer_credit_ledger" ADD CONSTRAINT "customer_credit_ledger_fk_0"
    FOREIGN KEY ("customer_id") REFERENCES public."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."customer_reward_grants" ADD CONSTRAINT "customer_reward_grants_fk_0"
    FOREIGN KEY ("rule_id") REFERENCES public."customer_reward_rules"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."customer_reward_grants" ADD CONSTRAINT "customer_reward_grants_fk_1"
    FOREIGN KEY ("gift_card_id") REFERENCES public."gift_cards"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."customer_reward_grants" ADD CONSTRAINT "customer_reward_grants_fk_2"
    FOREIGN KEY ("sale_id") REFERENCES public."sales"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."customer_reward_grants" ADD CONSTRAINT "customer_reward_grants_fk_3"
    FOREIGN KEY ("customer_id") REFERENCES public."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."daily_checklist_items" ADD CONSTRAINT "daily_checklist_items_fk_0"
    FOREIGN KEY ("run_id") REFERENCES public."daily_checklist_runs"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."document_assets" ADD CONSTRAINT "document_assets_fk_0"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."document_assets" ADD CONSTRAINT "document_assets_fk_1"
    FOREIGN KEY ("source_flyer_id") REFERENCES public."promotion_flyers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."document_assets" ADD CONSTRAINT "document_assets_fk_2"
    FOREIGN KEY ("branch_id") REFERENCES public."branches"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."donation_documents" ADD CONSTRAINT "donation_documents_fk_0"
    FOREIGN KEY ("donation_id") REFERENCES public."donations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_advances" ADD CONSTRAINT "employee_advances_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_attendance" ADD CONSTRAINT "employee_attendance_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_contracts" ADD CONSTRAINT "employee_contracts_fk_0"
    FOREIGN KEY ("template_id") REFERENCES public."employee_contract_templates"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_contracts" ADD CONSTRAINT "employee_contracts_fk_1"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_damage_costs" ADD CONSTRAINT "employee_damage_costs_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_disciplinary" ADD CONSTRAINT "employee_disciplinary_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_documents" ADD CONSTRAINT "employee_documents_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_hr_documents" ADD CONSTRAINT "employee_hr_documents_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_leave" ADD CONSTRAINT "employee_leave_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_loans" ADD CONSTRAINT "employee_loans_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_of_month" ADD CONSTRAINT "employee_of_month_fk_0"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_of_month" ADD CONSTRAINT "employee_of_month_fk_1"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_of_month_scores" ADD CONSTRAINT "employee_of_month_scores_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_payroll" ADD CONSTRAINT "employee_payroll_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_payroll_deductions" ADD CONSTRAINT "employee_payroll_deductions_fk_0"
    FOREIGN KEY ("payroll_id") REFERENCES public."employee_payroll"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_portal_feed" ADD CONSTRAINT "employee_portal_feed_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_probation" ADD CONSTRAINT "employee_probation_fk_0"
    FOREIGN KEY ("manager_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_probation" ADD CONSTRAINT "employee_probation_fk_1"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employee_schedules" ADD CONSTRAINT "employee_schedules_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."employees" ADD CONSTRAINT "employees_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."exchanges" ADD CONSTRAINT "exchanges_fk_0"
    FOREIGN KEY ("sale_id") REFERENCES public."sales"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."exchanges" ADD CONSTRAINT "exchanges_fk_1"
    FOREIGN KEY ("return_id") REFERENCES public."returns"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_fk_0"
    FOREIGN KEY ("gift_card_id") REFERENCES public."gift_cards"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."gift_cards" ADD CONSTRAINT "gift_cards_fk_0"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."held_orders" ADD CONSTRAINT "held_orders_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."hr_contract_templates" ADD CONSTRAINT "hr_contract_templates_fk_0"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."hr_staff_submissions" ADD CONSTRAINT "hr_staff_submissions_fk_0"
    FOREIGN KEY ("submitted_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."hr_staff_submissions" ADD CONSTRAINT "hr_staff_submissions_fk_1"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."hr_staff_submissions" ADD CONSTRAINT "hr_staff_submissions_fk_2"
    FOREIGN KEY ("reviewed_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."hr_staff_submissions" ADD CONSTRAINT "hr_staff_submissions_fk_3"
    FOREIGN KEY ("template_id") REFERENCES public."hr_contract_templates"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."hr_staff_submissions" ADD CONSTRAINT "hr_staff_submissions_fk_4"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."hr_training_records" ADD CONSTRAINT "hr_training_records_fk_0"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."hr_training_records" ADD CONSTRAINT "hr_training_records_fk_1"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."job_candidates" ADD CONSTRAINT "job_candidates_fk_0"
    FOREIGN KEY ("admin_decision_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."job_candidates" ADD CONSTRAINT "job_candidates_fk_1"
    FOREIGN KEY ("employ_request_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."job_candidates" ADD CONSTRAINT "job_candidates_fk_2"
    FOREIGN KEY ("posting_id") REFERENCES public."job_postings"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."job_postings" ADD CONSTRAINT "job_postings_fk_0"
    FOREIGN KEY ("approved_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."job_postings" ADD CONSTRAINT "job_postings_fk_1"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."kitchen_order_items" ADD CONSTRAINT "kitchen_order_items_fk_0"
    FOREIGN KEY ("kitchen_order_id") REFERENCES public."kitchen_orders"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."layby_items" ADD CONSTRAINT "layby_items_fk_0"
    FOREIGN KEY ("layby_id") REFERENCES public."laybyes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."layby_payments" ADD CONSTRAINT "layby_payments_fk_0"
    FOREIGN KEY ("layby_id") REFERENCES public."laybyes"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."laybyes" ADD CONSTRAINT "laybyes_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."laybyes" ADD CONSTRAINT "laybyes_fk_1"
    FOREIGN KEY ("customer_id") REFERENCES public."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_fk_0"
    FOREIGN KEY ("customer_id") REFERENCES public."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_access_tokens" ADD CONSTRAINT "marketing_access_tokens_fk_0"
    FOREIGN KEY ("agent_id") REFERENCES public."marketing_agents"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_agents" ADD CONSTRAINT "marketing_agents_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_fk_0"
    FOREIGN KEY ("agent_id") REFERENCES public."marketing_agents"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_customers" ADD CONSTRAINT "marketing_customers_fk_0"
    FOREIGN KEY ("customer_id") REFERENCES public."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_customers" ADD CONSTRAINT "marketing_customers_fk_1"
    FOREIGN KEY ("agent_id") REFERENCES public."marketing_agents"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_messages" ADD CONSTRAINT "marketing_messages_fk_0"
    FOREIGN KEY ("agent_id") REFERENCES public."marketing_agents"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_referrals" ADD CONSTRAINT "marketing_referrals_fk_0"
    FOREIGN KEY ("agent_id") REFERENCES public."marketing_agents"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_reports" ADD CONSTRAINT "marketing_reports_fk_0"
    FOREIGN KEY ("agent_id") REFERENCES public."marketing_agents"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."marketing_tasks" ADD CONSTRAINT "marketing_tasks_fk_0"
    FOREIGN KEY ("agent_id") REFERENCES public."marketing_agents"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."opening_checklist_templates" ADD CONSTRAINT "opening_checklist_templates_fk_0"
    FOREIGN KEY ("assigned_employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."opening_checklist_templates" ADD CONSTRAINT "opening_checklist_templates_fk_1"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."owner_draws" ADD CONSTRAINT "owner_draws_fk_0"
    FOREIGN KEY ("profile_id") REFERENCES public."owner_salary_profile"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."owner_draws" ADD CONSTRAINT "owner_draws_fk_1"
    FOREIGN KEY ("created_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."owner_salary_payment_allocations" ADD CONSTRAINT "owner_salary_payment_allocations_fk_0"
    FOREIGN KEY ("period_id") REFERENCES public."owner_salary_periods"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."owner_salary_payment_allocations" ADD CONSTRAINT "owner_salary_payment_allocations_fk_1"
    FOREIGN KEY ("payment_id") REFERENCES public."owner_salary_payments"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."owner_salary_payments" ADD CONSTRAINT "owner_salary_payments_fk_0"
    FOREIGN KEY ("profile_id") REFERENCES public."owner_salary_profile"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."owner_salary_periods" ADD CONSTRAINT "owner_salary_periods_fk_0"
    FOREIGN KEY ("profile_id") REFERENCES public."owner_salary_profile"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."owner_salary_profile" ADD CONSTRAINT "owner_salary_profile_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."po_receipt_items" ADD CONSTRAINT "po_receipt_items_fk_0"
    FOREIGN KEY ("receipt_id") REFERENCES public."po_receipts"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."po_receipts" ADD CONSTRAINT "po_receipts_fk_0"
    FOREIGN KEY ("po_id") REFERENCES public."purchase_orders"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."price_change_history" ADD CONSTRAINT "price_change_history_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."probation_daily_evaluations" ADD CONSTRAINT "probation_daily_evaluations_fk_0"
    FOREIGN KEY ("manager_id") REFERENCES public."employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."probation_daily_evaluations" ADD CONSTRAINT "probation_daily_evaluations_fk_1"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."probation_daily_evaluations" ADD CONSTRAINT "probation_daily_evaluations_fk_2"
    FOREIGN KEY ("probation_id") REFERENCES public."employee_probation"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."product_conversions" ADD CONSTRAINT "product_conversions_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."product_modifiers" ADD CONSTRAINT "product_modifiers_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."product_promo_requests" ADD CONSTRAINT "product_promo_requests_fk_0"
    FOREIGN KEY ("approved_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."product_promo_requests" ADD CONSTRAINT "product_promo_requests_fk_1"
    FOREIGN KEY ("proposed_by") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."product_promo_requests" ADD CONSTRAINT "product_promo_requests_fk_2"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."product_recipe_items" ADD CONSTRAINT "product_recipe_items_fk_0"
    FOREIGN KEY ("ingredient_product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."product_recipe_items" ADD CONSTRAINT "product_recipe_items_fk_1"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."product_variants" ADD CONSTRAINT "product_variants_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."production_batch_items" ADD CONSTRAINT "production_batch_items_fk_0"
    FOREIGN KEY ("ingredient_product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."production_batch_items" ADD CONSTRAINT "production_batch_items_fk_1"
    FOREIGN KEY ("batch_id") REFERENCES public."production_batches"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_fk_1"
    FOREIGN KEY ("recipe_profile_id") REFERENCES public."recipe_profiles"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."products" ADD CONSTRAINT "products_fk_0"
    FOREIGN KEY ("category_id") REFERENCES public."categories"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."purchase_order_items" ADD CONSTRAINT "purchase_order_items_fk_1"
    FOREIGN KEY ("purchase_order_id") REFERENCES public."purchase_orders"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."purchase_orders" ADD CONSTRAINT "purchase_orders_fk_1"
    FOREIGN KEY ("supplier_id") REFERENCES public."suppliers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."quote_items" ADD CONSTRAINT "quote_items_fk_0"
    FOREIGN KEY ("quote_id") REFERENCES public."quotes"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."quotes" ADD CONSTRAINT "quotes_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."quotes" ADD CONSTRAINT "quotes_fk_1"
    FOREIGN KEY ("customer_id") REFERENCES public."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."recipe_profiles" ADD CONSTRAINT "recipe_profiles_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."recipe_substitutions" ADD CONSTRAINT "recipe_substitutions_fk_0"
    FOREIGN KEY ("to_product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."recipe_substitutions" ADD CONSTRAINT "recipe_substitutions_fk_1"
    FOREIGN KEY ("from_product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."recipe_substitutions" ADD CONSTRAINT "recipe_substitutions_fk_2"
    FOREIGN KEY ("recipe_profile_id") REFERENCES public."recipe_profiles"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."recipe_user_access" ADD CONSTRAINT "recipe_user_access_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."recipe_versions" ADD CONSTRAINT "recipe_versions_fk_0"
    FOREIGN KEY ("recipe_profile_id") REFERENCES public."recipe_profiles"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."recipe_waste_logs" ADD CONSTRAINT "recipe_waste_logs_fk_0"
    FOREIGN KEY ("recipe_profile_id") REFERENCES public."recipe_profiles"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."recipe_waste_logs" ADD CONSTRAINT "recipe_waste_logs_fk_1"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."return_items" ADD CONSTRAINT "return_items_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."return_items" ADD CONSTRAINT "return_items_fk_1"
    FOREIGN KEY ("return_id") REFERENCES public."returns"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."returns" ADD CONSTRAINT "returns_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."returns" ADD CONSTRAINT "returns_fk_1"
    FOREIGN KEY ("sale_id") REFERENCES public."sales"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_fk_0"
    FOREIGN KEY ("promo_request_id") REFERENCES public."product_promo_requests"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_fk_1"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_fk_2"
    FOREIGN KEY ("sale_id") REFERENCES public."sales"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."sale_payments" ADD CONSTRAINT "sale_payments_fk_0"
    FOREIGN KEY ("sale_id") REFERENCES public."sales"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."sales" ADD CONSTRAINT "sales_fk_0"
    FOREIGN KEY ("customer_id") REFERENCES public."customers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."sales" ADD CONSTRAINT "sales_fk_1"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."shifts" ADD CONSTRAINT "shifts_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."shop_operating_log" ADD CONSTRAINT "shop_operating_log_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."staff_login_selfies" ADD CONSTRAINT "staff_login_selfies_fk_0"
    FOREIGN KEY ("employee_id") REFERENCES public."employees"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."stock_count_lines" ADD CONSTRAINT "stock_count_lines_fk_0"
    FOREIGN KEY ("count_id") REFERENCES public."stock_counts"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."stock_movements" ADD CONSTRAINT "stock_movements_fk_1"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."supplier_payments" ADD CONSTRAINT "supplier_payments_fk_0"
    FOREIGN KEY ("supplier_id") REFERENCES public."suppliers"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."supplier_products" ADD CONSTRAINT "supplier_products_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."supplier_products" ADD CONSTRAINT "supplier_products_fk_1"
    FOREIGN KEY ("supplier_id") REFERENCES public."suppliers"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."user_login_events" ADD CONSTRAINT "user_login_events_fk_0"
    FOREIGN KEY ("user_id") REFERENCES public."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."waste_records" ADD CONSTRAINT "waste_records_fk_0"
    FOREIGN KEY ("product_id") REFERENCES public."products"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."whatsapp_campaigns" ADD CONSTRAINT "whatsapp_campaigns_fk_0"
    FOREIGN KEY ("template_id") REFERENCES public."whatsapp_templates"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_fk_0"
    FOREIGN KEY ("campaign_id") REFERENCES public."whatsapp_campaigns"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_fk_1"
    FOREIGN KEY ("template_id") REFERENCES public."whatsapp_templates"("id");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN invalid_foreign_key THEN NULL; END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_penalties_emp ON public."attendance_penalties"(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_date ON public."audit_log"(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_unique ON public."budgets"(budget_month, category, department);
CREATE INDEX IF NOT EXISTS idx_cash_drops_date ON public."cash_drops"(created_at);
CREATE INDEX IF NOT EXISTS idx_cash_drops_shift ON public."cash_drops"(shift_id, status);
CREATE INDEX IF NOT EXISTS idx_cashout_penalties_emp ON public."cashout_penalties"(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_categories_show_on_pos ON public."categories"(show_on_pos);
CREATE INDEX IF NOT EXISTS idx_categories_sort ON public."categories"(is_active, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_checklist_items_run ON public."daily_checklist_items"(run_id);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_date ON public."daily_checklist_runs"(run_date, run_type);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_employee ON public."daily_checklist_runs"(employee_id, run_date, run_type);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_status ON public."daily_checklist_runs"(status, run_date);
CREATE INDEX IF NOT EXISTS idx_closing_tpl_employee ON public."closing_checklist_templates"(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_combo_items_combo ON public."combo_items"(combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_sale_log_combo ON public."combo_sale_log"(combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_sale_log_sale ON public."combo_sale_log"(sale_id);
CREATE INDEX IF NOT EXISTS idx_combos_branch ON public."combos"(branch_id);
CREATE INDEX IF NOT EXISTS idx_combos_status ON public."combos"(status);
CREATE INDEX IF NOT EXISTS idx_compliance_submissions ON public."payroll_compliance_submissions"(submission_type, period_month);
CREATE INDEX IF NOT EXISTS idx_compliance_warnings_date ON public."compliance_checklist_warnings"(run_date, run_type);
CREATE INDEX IF NOT EXISTS idx_contracts_emp ON public."employee_contracts"(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_assets_branch ON public."document_assets"(branch_id);
CREATE INDEX IF NOT EXISTS idx_document_assets_flyer ON public."document_assets"(source_flyer_id);
CREATE INDEX IF NOT EXISTS idx_document_assets_schedule ON public."document_assets"(status, schedule_at);
CREATE INDEX IF NOT EXISTS idx_document_assets_type ON public."document_assets"(doc_type, status);
CREATE INDEX IF NOT EXISTS idx_donation_docs_donation ON public."donation_documents"(donation_id);
CREATE INDEX IF NOT EXISTS idx_donations_branch ON public."donations"(branch_id);
CREATE INDEX IF NOT EXISTS idx_donations_date ON public."donations"(donation_date);
CREATE INDEX IF NOT EXISTS idx_donations_status ON public."donations"(status);
CREATE INDEX IF NOT EXISTS idx_employee_advances_emp ON public."employee_advances"(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_attendance_date ON public."employee_attendance"(work_date, employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_attendance_open ON public."employee_attendance"(work_date, clock_out);
CREATE INDEX IF NOT EXISTS idx_employee_damage_emp ON public."employee_damage_costs"(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_leave_status ON public."employee_leave"(status);
CREATE INDEX IF NOT EXISTS idx_employee_loans_emp ON public."employee_loans"(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_schedules_date ON public."employee_schedules"(shift_date);
CREATE INDEX IF NOT EXISTS idx_employees_status ON public."employees"(status);
CREATE INDEX IF NOT EXISTS idx_flyers_branch ON public."promotion_flyers"(branch_id);
CREATE INDEX IF NOT EXISTS idx_flyers_status ON public."promotion_flyers"(status, start_date);
CREATE INDEX IF NOT EXISTS idx_hr_documents_emp ON public."employee_hr_documents"(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_submissions_assigned ON public."hr_staff_submissions"(assigned_to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_submissions_status ON public."hr_staff_submissions"(status, template_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_tpl_key ON public."hr_contract_templates"(template_key) WHERE template_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_training_emp ON public."hr_training_records"(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_job_candidates_posting ON public."job_candidates"(posting_id, status);
CREATE INDEX IF NOT EXISTS idx_job_postings_status ON public."job_postings"(status);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status ON public."kitchen_orders"(status);
CREATE INDEX IF NOT EXISTS idx_ledger_category ON public."ledger_entries"(category);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON public."ledger_entries"(txn_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_ref ON public."ledger_entries"(reference_type, reference_id, txn_type, COALESCE(subcategory,''));
CREATE INDEX IF NOT EXISTS idx_ledger_type ON public."ledger_entries"(txn_type);
CREATE INDEX IF NOT EXISTS idx_mkt_menu_templates_type ON public."marketing_menu_templates"(menu_type);
CREATE INDEX IF NOT EXISTS idx_mkt_sync_conflicts_status ON public."marketing_sync_conflicts"(status);
CREATE INDEX IF NOT EXISTS idx_online_orders_local_sale ON public."legacy_online_orders_local"(sale_id);
CREATE INDEX IF NOT EXISTS idx_opening_tpl_employee ON public."opening_checklist_templates"(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_owner_draws_profile ON public."owner_draws"(profile_id, draw_date);
CREATE INDEX IF NOT EXISTS idx_owner_salary_payments_profile ON public."owner_salary_payments"(profile_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_owner_salary_periods_profile ON public."owner_salary_periods"(profile_id, period_end);
CREATE INDEX IF NOT EXISTS idx_owner_salary_periods_status ON public."owner_salary_periods"(status);
CREATE INDEX IF NOT EXISTS idx_payroll_deductions_payroll ON public."employee_payroll_deductions"(payroll_id);
CREATE INDEX IF NOT EXISTS idx_portal_feed_employee ON public."employee_portal_feed"(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_probation_emp ON public."employee_probation"(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_probation_eval ON public."probation_daily_evaluations"(probation_id, eval_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_conversions_product ON public."product_conversions"(product_id);
CREATE INDEX IF NOT EXISTS idx_product_modifiers_product ON public."product_modifiers"(product_id);
CREATE INDEX IF NOT EXISTS idx_product_recipe_ingredient ON public."product_recipe_items"(ingredient_product_id);
CREATE INDEX IF NOT EXISTS idx_product_recipe_product ON public."product_recipe_items"(product_id);
CREATE INDEX IF NOT EXISTS idx_production_batches_date ON public."production_batches"(created_at);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public."products"(barcode);
CREATE INDEX IF NOT EXISTS idx_products_best_seller ON public."products"(is_best_seller);
CREATE INDEX IF NOT EXISTS idx_products_category ON public."products"(category_id);
CREATE INDEX IF NOT EXISTS idx_products_show_on_pos ON public."products"(show_on_pos);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public."products"(sku);
CREATE INDEX IF NOT EXISTS idx_promo_requests_product ON public."product_promo_requests"(product_id, status);
CREATE INDEX IF NOT EXISTS idx_promo_requests_status ON public."product_promo_requests"(status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_quotes_status_expires ON public."quotes"(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_recipe_activity_created ON public."recipe_activity_log"(created_at);
CREATE INDEX IF NOT EXISTS idx_recipe_profiles_product ON public."recipe_profiles"(product_id);
CREATE INDEX IF NOT EXISTS idx_recipe_profiles_status ON public."recipe_profiles"(status);
CREATE INDEX IF NOT EXISTS idx_recipe_subs_status ON public."recipe_substitutions"(status);
CREATE INDEX IF NOT EXISTS idx_recipe_waste_status ON public."recipe_waste_logs"(status);
CREATE INDEX IF NOT EXISTS idx_reward_grants_customer ON public."customer_reward_grants"(customer_id, rule_id, granted_at);
CREATE INDEX IF NOT EXISTS idx_rules_status ON public."company_rules"(status);
CREATE INDEX IF NOT EXISTS idx_sales_date ON public."sales"(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_order_number ON public."sales"(order_number);
CREATE INDEX IF NOT EXISTS idx_sales_order_type ON public."sales"(order_type, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_receipt ON public."sales"(receipt_number);
CREATE INDEX IF NOT EXISTS idx_sales_table_id ON public."sales"(table_id);
CREATE INDEX IF NOT EXISTS idx_shop_operating_log_date ON public."shop_operating_log"(event_at);
CREATE INDEX IF NOT EXISTS idx_staff_selfies_date ON public."staff_login_selfies"(login_date DESC, employee_id);
CREATE INDEX IF NOT EXISTS idx_staff_selfies_emp ON public."staff_login_selfies"(employee_id, login_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_product ON public."stock_movements"(product_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_codes_date ON public."supervisor_codes"(code_date, purpose);
CREATE INDEX IF NOT EXISTS idx_user_login_events_at ON public."user_login_events"(event_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_login_events_user ON public."user_login_events"(user_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_campaigns_status ON public."whatsapp_campaigns"(status);
CREATE INDEX IF NOT EXISTS idx_wa_messages_branch ON public."whatsapp_messages"(branch_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_date ON public."whatsapp_messages"(sent_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_status ON public."whatsapp_messages"(status);
CREATE INDEX IF NOT EXISTS idx_wa_messages_type ON public."whatsapp_messages"(message_type);
