# Workforce Planning — Audit & Deliverables

**Project:** Chisanyama Connection / Shop POS  
**Module:** Advanced Staff Shift Generator, Workforce Planning & Payroll  
**Date:** 2026-10-30

## 1. Audit (Phase One findings)

| Area | Existing | Action taken |
|---|---|---|
| Admin Staff & HR | Employees, work_schedule JSON, shift generator, payroll, leave | Extended with Staffing & Busy Days + Performance Rewards tabs; Shift Generator upgraded |
| Shift generation | `staff.autoGenerateShifts` (per-employee work_days calendar) | Extended via `workforce-planning.generateIntelligentShifts` (coverage, busy-day priority, locks, conflicts); legacy kept as fallback |
| Workers / branches / roles | `employees` table | Reused; no duplicate worker records |
| Payroll / pay types | `attendance-payroll` monthly / hourly / daily via `work_schedule.pay_type` | Reused; rewards added into payroll as bonus on approve |
| Attendance / timesheets | `employee_attendance`, portal clock in/out | Unchanged; rewards/payroll read approved hours |
| Staff portal | My Shifts, earnings, leave, payslips | Added My Rewards; employee schedule fetch uses `publishedOnly` |
| Schema | `employee_schedules`, leave, payroll | Additive columns + new tables only (v137 / 20261030) |
| Performance targets | Shop daily sales targets exist | Wired to tiered staff rewards from verified POS sales |
| Reports / payslips | Existing payroll + PDF | Preserved; labour forecast + conflict report added in admin |
| Tests | Temp-sqlite scripts | `scripts/test-workforce-planning.js` → `WORKFORCE_PLANNING_OK` |

**Missing before this work:** weekly staffing requirements by day/busy class, shift lock/publish, conflict report, sales-tier staff rewards ledger, portal reward visibility.

## 2. Files modified / added

**Added**
- `electron/services/workforce-planning.js`
- `electron/database/migrations-v137-workforce-planning.sql`
- `supabase/migrations/20261030_workforce_planning.sql`
- `scripts/test-workforce-planning.js`
- `docs/workforce-planning.md`

**Modified**
- `electron/services/staff.js` — saveSchedule lock/publish fields; autoGenerate → WF engine; payroll reward hook; getSchedules `publishedOnly`
- `electron/services/attendance-payroll.js` — (existing pay methods used as-is)
- `electron/main.js`, `electron/preload.js`, `mobile/handlers.js`, `src/js/api.js` — workforce RPCs
- `src/js/pages/admin-staff.js` — Staffing, Rewards, Shift Generator lock/publish/conflicts/forecast
- `src/js/pages/staff.js` — My Rewards section

## 3. Database changes

**`employee_schedules` columns (additive):** `is_locked`, `is_published`, `published_at`, `job_role`, `schedule_status`

**New tables:** `staffing_requirements`, `staff_performance_reward_rules`, `staff_performance_rewards` (`calc_key` UNIQUE), `employee_schedule_history`

**Rollback:** drop new tables; ignore new columns (safe to leave). Do not delete historical `employee_schedules` or payroll rows. Runtime `ensureWorkforceSchema()` also applies columns/tables idempotently.

## 4. Shift-generation logic

1. Load active employees (optional branch / ID filter).  
2. Preserve `is_locked = 1` rows; delete unlocked rows in range.  
3. Sort dates by busy classification (very_busy → busy → normal).  
4. For each day: fill to target/min from candidates scored by preference, remaining weekly target, leave/unavailable blocks, hour caps.  
5. If still under **minimum** staffing, allow over-target assignment with an `over_target_for_coverage` warning.  
6. Emit role-coverage / understaffed / worker-target conflict rows.  
7. Persist as **draft** (`is_published = 0`) unless `publish: true`.  
8. Admin **Publish** sets published flags for the portal.

## 5. Salary calculation examples

| Method | Config | Example | Result |
|---|---|---|---|
| Monthly | `monthly_salary: 1200` | Period rules in payroll | Base salary per policy — not auto-cut for fewer days |
| Hourly | `hourly_rate: 25`, 8h approved | 8 × 25 | **R200.00** ordinary |
| Daily | `daily_wage: 150` (via hourly equiv in day calc) | Approved day attendance | Payable day earnings from attendance engine |

Estimates in labour forecast label monthly amounts as allocations, not extra pay.

## 6. Reward rules

- Admin configures target + tiers (e.g. R2 000 → R20, R3 000+ → R50).  
- `calculateDayRewards` uses POS `sales` totals (or forced total).  
- Eligible: active staff scheduled or attended that day (optional role filter).  
- Unique `calc_key = date|employeeId|amount` prevents duplicates.  
- Status: pending → approved → paid (via `applyApprovedRewardsToPayroll`).

## 7. Staff portal

- **My Shifts:** published schedules only (`publishedOnly` for employee session).  
- **My Rewards:** own rows via filtered `workforce:listRewards`.  
- Earnings / payslips / attendance unchanged paths; salary isolation preserved (employee session scoped).

## 8. Tests

```text
node scripts/test-workforce-planning.js
→ WORKFORCE_PLANNING_OK
```

Covers: day targets, 1-week + 4-week generate, lock preserve, locked edit block, publish, coverage, reward tiers + no dupes, hourly R200.

## 9. Admin UI entry points

Admin → Staff & HR → **Shift Generator** | **Staffing & Busy Days** | **Performance Rewards**

## 10. Deploy / rollback

1. Backup DB before production migrate.  
2. Deploy app build; SQLite applies `migrations-v137`; Postgres applies `20261030_workforce_planning.sql` via existing boot migrator.  
3. Staging smoke: generate draft → publish → portal My Shifts/Rewards → run payroll with approved reward.  
4. Rollback app revision if needed; new tables unused leave data intact.

## 11. Not fully implemented / deferred

- Per-slot morning/afternoon/evening staffing UI (schema supports `shift_slot`; engine uses `all`).  
- Full SA statutory legal review (implementer must have payroll/labour specialist sign-off before production reliance).  
- Dedicated versioned schedule “diff UI” (history table exists; admin timeline UI minimal).  
- Automated screenshot capture of admin screens (manual verify in staging).  
- Live Railway deploy of this workforce commit may still need Railway auth if previously blocked.
