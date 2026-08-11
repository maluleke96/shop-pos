/** Default Chisanyama Connection employment contract — editable via Admin → Contracts & Probation → Templates */
module.exports = `# CHISANYAMA CONNECTION

## EMPLOYMENT CONTRACT

### 1. Employer Information

**Business Name:** {{business_name}}

**Branch:** {{branch}}

**Business Address:** {{business_address}}

**Telephone:** {{business_phone}}

**Email:** {{business_email}}

---

## 2. Employee Information

**Full Name:** {{employee_name}}

**ID/Passport Number:** {{id_number}}

**Employee Number:** {{employee_number}}

**Residential Address:** {{address}}

**Phone Number:** {{phone}}

**Email Address:** {{email}}

---

## 3. Position

The Employee is employed as:

**Job Title:** {{position}}

**Department:** {{department}}

**Reports To:** {{reports_to}}

---

## 4. Employment Type

{{employment_type_permanent}} Permanent
{{employment_type_fixed}} Fixed-Term
{{employment_type_temporary}} Temporary
{{employment_type_casual}} Casual
{{employment_type_parttime}} Part-Time

---

## 5. Employment Start Date

Start Date: {{start_date}}

If Fixed-Term:

End Date: {{end_date}}

---

## 6. Probation Period

The Employee shall serve a probation period of:

{{probation_two_weeks}} Two Weeks
{{probation_one_month}} One Month
{{probation_two_months}} Two Months
{{probation_three_months}} Three Months
{{probation_other}} Other: {{probation_other_text}}

During probation, the Employee's performance, attendance, punctuality, conduct, productivity and adherence to company policies will be evaluated.

Successful completion of probation does not automatically guarantee permanent employment. Confirmation of employment remains at the discretion of the Employer based on performance and business requirements.

---

## 7. Working Hours

Normal Working Hours:

From: {{shift_start}}

To: {{shift_end}}

Working Days:

{{day_monday}} Monday
{{day_tuesday}} Tuesday
{{day_wednesday}} Wednesday
{{day_thursday}} Thursday
{{day_friday}} Friday
{{day_saturday}} Saturday
{{day_sunday}} Sunday

Meal Break:

{{break_minutes}} minutes

Employees are required to clock in and clock out using the company's attendance system.

Payroll is calculated using attendance records.

Failure to clock in or clock out may affect salary calculations unless approved by management.

---

## 8. Salary

Salary Type:

{{salary_monthly}} Monthly
{{salary_weekly}} Weekly
{{salary_daily}} Daily
{{salary_hourly}} Hourly

Salary Amount:

{{currency}}{{salary_amount}}

Payment Method:

{{pay_bank}} Bank Transfer
{{pay_cash}} Cash
{{pay_other}} Other

Payment Date: {{payment_date}}

---

## 9. Overtime

Overtime must be authorised by management.

Approved overtime will be paid according to company policy and applicable labour legislation.

---

## 10. Attendance

Employees are expected to:

* Report to work on time.
* Clock in before starting work.
* Clock out after finishing work.
* Notify management if unable to attend work.

Repeated lateness or absenteeism may result in disciplinary action.

---

## 11. Employee Duties

The Employee agrees to:

* Perform assigned duties diligently.
* Maintain professional behaviour.
* Follow lawful instructions from supervisors.
* Provide excellent customer service.
* Maintain workplace cleanliness.
* Handle company property responsibly.
* Follow all food safety and hygiene requirements.
* Wear the required uniform.
* Protect company property.
* Maintain confidentiality.

---

## 12. Company Property

Any company property issued to the Employee remains the property of Chisanyama Connection.

This includes uniforms, keys, devices, equipment, documents, and access cards.

These must be returned upon termination of employment.

---

## 13. Confidentiality

The Employee shall not disclose confidential company information including customer information, financial records, recipes, supplier information, business strategies, pricing, sales information, and staff information.

This obligation continues after employment ends.

---

## 14. Code of Conduct

Employees must treat customers respectfully, respect fellow employees, avoid fighting, harassment or discrimination, follow all health and safety procedures, follow management instructions, and maintain honesty and integrity.

---

## 15. Leave

Employees are entitled to leave in accordance with company policy and applicable labour legislation.

Leave must be approved before being taken unless it is an emergency.

---

## 16. Disciplinary Procedure

Misconduct may result in verbal warning, written warning, final written warning, disciplinary hearing, suspension, or dismissal.

The Employer will follow a fair disciplinary process before taking disciplinary action.

---

## 17. Termination

Employment may be terminated by resignation, mutual agreement, expiry of a fixed-term contract, dismissal following a fair disciplinary process, or for operational requirements in accordance with applicable labour legislation.

Notice periods will comply with company policy and applicable labour law.

---

## 18. Health and Safety

The Employee agrees to comply with all workplace health and safety rules and immediately report hazards, injuries or accidents.

---

## 19. Entire Agreement

This contract constitutes the entire agreement between the Employer and the Employee. Any amendments must be made in writing and signed by both parties.

{{custom_clauses}}

---

# Employer Declaration

I confirm that I am authorised to employ the Employee under the terms contained in this agreement.

Employer Name: {{employer_name}}

Position: {{employer_position}}

Signature: _________________________

Date: {{signature_date}}

---

# Employee Declaration

I confirm that I have read, understood and agree to comply with the terms and conditions contained in this Employment Contract.

Employee Name: {{employee_name}}

Signature: _________________________

Date: {{signature_date}}

---

# Witness (Optional)

Witness Name: {{witness_name}}

Signature: _________________________

Date: {{signature_date}}
`;
