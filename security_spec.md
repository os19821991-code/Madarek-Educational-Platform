# Security Specification & Invariants — Madarik School Platform

## 1. Data Invariants
1. **Identity Isolation**: Users may never create or escalate their own `role` to `'admin'`. Only the verified bootstrapped principal (`os19821991@gmail.com` with `email_verified == true`) or existing admins in `/admins/{uid}` possess administrative authority.
2. **PII & Student Ownership**: Every student, attendance record, grade record, invoice, message, and notification carries an immutable `parentUid` field. Non-admin users can read/list only records where `resource.data.parentUid == request.auth.uid`.
3. **Terminal Payment Locking**: Once an invoice transitions to `status == 'paid'`, non-admin users cannot modify its `amount`, `status`, `receiptRef`, or `studentId`.
4. **Master Gate for Subcollections**: Activity registrations at `/activities/{activityId}/registrations/{registrationId}` verify parent activity existence via `exists()` and enforce `parentUid == request.auth.uid`.
5. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps are strictly validated against `request.time`.

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Self-Role Escalation**: `POST /users/{uid}` with `role: 'admin'` by non-admin user -> Rejected by `incoming().role == 'parent'`.
2. **Ghost Field Injection (Shadow Update)**: `UPDATE /students/{id}` with extra field `isScholarshipApproved: true` -> Rejected by `affectedKeys().hasOnly(...)`.
3. **Unverified Admin Email Spoof**: Request with `email == 'os19821991@gmail.com'` and `email_verified == false` -> Rejected by `isVerified()`.
4. **ID Poisoning**: `CREATE /students/{1500_char_id}` -> Rejected by `isValidId()` (`<= 128` chars, alphanumeric/dash/underscore).
5. **Cross-Parent Student Scraping**: `LIST /students` as parent without `where('parentUid', '==', uid)` -> Rejected by `resource.data.parentUid == request.auth.uid`.
6. **Negative Invoice Tampering**: `UPDATE /invoices/{id}` by parent changing `amount: -500` -> Rejected by `affectedKeys().hasOnly(['status', 'paymentMethod', 'receiptRef', 'updatedAt'])`.
7. **Terminal State Bypass**: `UPDATE /invoices/{paidId}` by parent trying to reset `status: 'pending'` -> Rejected by `existing().status != 'paid'`.
8. **Orphaned Activity Registration**: `CREATE /activities/nonexistent/registrations/reg1` -> Rejected by `exists(/databases/.../activities/nonexistent)`.
9. **Spoofed Sender Message**: `CREATE /messages/{id}` by parent setting `senderRole: 'teacher'` -> Rejected by `incoming().senderRole == 'parent'`.
10. **Client Timestamp Forgery**: `CREATE /announcements/{id}` with backdated `createdAt` -> Rejected by `incoming().createdAt == request.time`.
11. **Non-Admin Teacher Evaluation Tamper**: `CREATE /teachers/{id}` by parent -> Rejected by `isAdmin()`.
12. **Blanket Library Overwrite**: `UPDATE /libraryResources/{id}` by parent changing `title` or `summary` -> Rejected by `affectedKeys().hasOnly(['downloadCount', 'updatedAt'])`.
13. **Unauthorized Permission Matrix Modification**: `UPDATE /rolePermissions/supervisor` by non-admin user -> Rejected by `isAdmin()`.
14. **Self-Role Escalation to Supervisor/Teacher**: `POST /users/{uid}` with `role: 'teacher'` or `'supervisor'` by non-admin -> Rejected by `incoming().role == 'parent' || isAdmin()`.
15. **Supervisor Grade Tampering**: `CREATE /grades/{id}` by supervisor (`markAttendance: true`, `publishGrades: false`) -> Rejected by `hasCurrentRolePermission('publishGrades')`.
16. **Behavior Score Inflation**: `UPDATE /students/{id}` attempting to increase `behaviorScore` (e.g., from `90` to `95` or `100`, even by admin/teacher/supervisor) -> Rejected by `incoming().behaviorScore < currentBehaviorScore` (updates may only decrease, never increase).
17. **Parent Behavior Deduction Attempt**: `UPDATE /students/{id}` (`behaviorScore`) or `CREATE /behaviorDeductions/{id}` by a `parent` user -> Rejected because only `'admin'`, `'teacher'`, or `'supervisor'` roles are permitted to deduct behavior scores.
18. **Behavior Log Tampering**: `UPDATE` or `DELETE` on `/behaviorDeductions/{id}` -> Rejected by immutable `allow update, delete: if false;`.
19. **Unauthorized Period Attendance Marking**: `CREATE /periodAttendance/{id}` by a `parent` user (`markAttendance: false`) -> Rejected by `isAdmin() || hasCurrentRolePermission('markAttendance')`.
20. **Period Attendance Key Tampering**: `UPDATE /periodAttendance/{id}` attempting to alter `periodNumber`, `date`, `studentId`, or `parentUid` -> Rejected by immutability guards and `affectedKeys().hasOnly(...)`.
21. **Unauthorized Calendar Event Creation**: `CREATE /calendarEvents/{id}` by a `parent` or `supervisor` without permission -> Rejected because only verified `'admin'` or `'teacher'` roles (or roles with `manageAnnouncements` / `publishGrades`) can create, update, or delete calendar events.
22. **Calendar Event Scope Tampering**: `CREATE /calendarEvents/{id}` setting `scope != 'school'` or forging `createdAt` -> Rejected by `isValidCalendarEvent()` and `incoming().createdAt == request.time`.
23. **Detached or Negative Donation Spoofing**: `CREATE /donations/{id}` with `amount <= 0`, spoofed `donorUid != request.auth.uid`, or without atomically incrementing `collectedAmount` and `donorsCount` on `/donationCampaigns/{campaignId}` in the same batch -> Rejected by `isValidDonation()`, `donorUid == request.auth.uid`, and `getAfter()` atomicity checks.
24. **Unauthorized Donation Campaign Tampering**: `CREATE` or metadata `UPDATE` on `/donationCampaigns/{id}` by non-admin/non-billing user, or modifying `collectedAmount` to a smaller value -> Rejected by `isAdmin() || hasCurrentRolePermission('manageBilling')` and `incoming().collectedAmount > existing().collectedAmount`.

