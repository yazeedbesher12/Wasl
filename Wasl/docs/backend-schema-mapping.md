# Phase 1 schema / API mapping

`apps/api/prisma/schema.prisma` remains unchanged and is authoritative. API UUIDs
are PostgreSQL UUID strings, not browser fixture IDs. Persistence entities in
`apps/api/src/foundation/entities.ts` use `Date`; explicit serializers in
`mapping.ts` produce public DTOs. No ORM entity is returned from a controller.

| Prisma model (SQL mapping) | Persisted fields / relevant constraints | Phase 1 API |
| --- | --- | --- |
| School (`schools`) | UUID id; name; nullable nameAr; Locale ar/en; active; createdAt | Platform CRUD excluding deletion; active=false suspends, active=true reactivates. Counts are derived, not stored. |
| User (`users`) | UUID id; globally unique email; fullName; passwordHash; preferredLanguage; active; createdAt | Public profile excludes passwordHash. Creation normalizes email and hashes a supplied password. Only the identity owner updates fullName/language at `/me/profile`. |
| Membership (`memberships`) | UUID id; userId FK; nullable schoolId FK; Role; active; createdAt; unique userId/schoolId/role | School Admin creates school roles and changes active. Role/identity/school are immutable. PLATFORM_ADMIN must have null schoolId and is not creatable through school APIs. |
| ParentStudentLink (`parent_student_links`) | UUID id; schoolId; parentId/studentId User FKs; LinkStatus PENDING/VERIFIED/REJECTED; nullable verifiedAt; createdAt; unique parentId/studentId globally | Creation is PENDING; verification sets verifiedAt. Rejection/revocation uses REJECTED and clears verifiedAt. PENDING can request another review. No nonexistent revoked flag or REVOKED enum. |
| RefreshToken (`refresh_tokens`) | UUID id; userId FK; unique tokenHash; expiresAt; nullable revokedAt; createdAt | SHA-256 hash of opaque refresh token. Rotation conditionally consumes the old row and creates the replacement in one transaction. No plaintext token returned by repositories or inspection endpoints. |
| AcademicYear (`academic_years`) | UUID id; schoolId FK; name; startDate/endDate `@db.Date`; archived; unique schoolId/name | CRUD excluding delete, including archive/unarchive. Dates are validated and must contain all existing semesters. |
| Semester (`semesters`) | UUID id; schoolId; academicYearId FK; name; date-only startDate/endDate | CRUD excluding delete; dates contained by year. There is no archive/active field and no unique name constraint. |
| Grade (`grades`) | UUID id; schoolId FK; name; PostgreSQL Int level; unique schoolId/level | CRUD excluding delete. No artificial supported-grade list or archive flag. |
| Section (`sections`) | UUID id; schoolId; gradeId/yearId FKs (`academicYearId`); name; unique gradeId/academicYearId/name | CRUD excluding delete; relationships checked in the same school. Grade/year identifiers are immutable after creation to avoid moving historical relationships. |
| Subject (`subjects`) | UUID id; schoolId FK; nameAr/nameEn; nullable code | CRUD excluding delete. Code is NOT unique in this schema. No active/archive field. |
| SectionSubject (`section_subjects`) | UUID id; schoolId; sectionId/subjectId FKs; nullable teacherId UUID; unique sectionId/subjectId | Assignment create/update; teacher can be changed/unassigned only to an eligible teacher or null. Section/subject identifiers are immutable. No active/archive/status field. |
| Enrollment (`enrollments`) | UUID id; schoolId; sectionId FK; studentId UUID; EnrollmentStatus ACTIVE/TRANSFERRED/GRADUATED/WITHDRAWN; createdAt; unique sectionId/studentId | Create/update status. Section/student identifiers are immutable. No extra academicYearId: year comes through section. No deletion. |

All timestamp responses are UTC ISO-8601 (`...Z`). Academic date-only inputs and
outputs are exactly `YYYY-MM-DD`; internal UTC midnight is an adapter convention
for PostgreSQL DATE, not a time-zone conversion of a school-local instant. Invalid
calendar dates, reversed intervals, and semester dates outside their year fail.
School and user creation timestamps, link verification timestamps, enrollment
creation time, and ownership fields are server-controlled.

New semesters, sections, assignments and enrollments require an unarchived year.
Reactivating an enrollment requires that year and its student membership to be
available. A historical enrollment may transition to an inactive status even if
its student membership is inactive. No one-enrollment-per-year, automatic date-based
graduation, semester non-overlap or extra lifecycle statuses are imposed.

An explicit Platform Admin school-management route provisions a new school's
SCHOOL_ADMIN (or reactivates its existing membership). Its target school UUID is
accepted only after Platform Admin authorization, not through ordinary school
resource bodies. Existing identities must be attached by email without profile/
password replacement. This is a membership, not a persisted designated contact.

## Explicit derived values

- Platform school student/teacher counts count active memberships of active users
  in that school, separately per role; a suspended school retains its aggregates.
- Admin overview counts use the actual school records; `activeEnrollments` means
  Enrollment.status=ACTIVE, not an inferred graduation or attendance decision.
- Student/parent counts and subjects use ACTIVE enrollment, an active student
  membership/user, and a non-archived year. Teacher reads use their teacherId
  assignments in non-archived years. Admin can still inspect historical records.
- Grade and year come through Section; subject and teacher through SectionSubject.
  Names in overview/class DTOs are joins. An unavailable teacher is represented by
  a null teacher profile, without deleting the assignment.
- Rosters show active enrolled students with active student memberships; only id
  and fullName are exposed there. They do not return a global user directory.

## Frontend mapping and gaps

The browser/native `packages/shared/src/demo` remains untouched. Its flexible
records, bilingual `name/nameAr`, generic active flags, preferences, events and
snapshot version are NOT database tables or API DTOs. The server's fictional
bootstrap is a separate dataset with valid UUIDs; no saved frontend IDs are changed.

| Frontend value/behavior | Current schema / future decision |
| --- | --- |
| School city, location, administrator contact/name/email | No School columns for these. Administrator memberships/users are identity records, not a unique designated school contact. A later approved migration may add explicit contact/location fields or a designated contact relationship. Do not send `.demo` to this API. |
| Bilingual full names on every record | User.fullName, Grade.name, Section.name, year/semester name are single strings. School.nameAr is nullable; Subject has nameAr/nameEn. Additional translations require an approved schema change, not duplicate identities. |
| Generic archive/activate controls | Only School/User/Membership have active; AcademicYear has archived; Enrollment has four statuses. Other Phase 1 models cannot archive. The old hard DELETE subject endpoint is removed rather than pretending an archive exists. |
| Current academic year preference / semester preference | No settings/preference table. Current year is not selected automatically by this API. An explicit academicYearId filter is available. A future preference relationship needs a migration. |
| Relationship reparenting | This API preserves identifiers/history: section grade/year, semester year, assignment section/subject and enrollment section/student cannot be changed in place. Create a new relationship; withdraw/transfer the old enrollment, unassign a teacher where appropriate. This is a conservative API policy, not a claim of a database trigger. |
| Class archive or permanent removal | Not representable by SectionSubject. teacherId=null unassigns the teacher; it does not archive the class or delete its history. |
| Parent link revoked status or approval history | REJECTED/null verifiedAt revokes current access. There is no status audit trail, revocation reason or distinct revoked status. Consider explicit history in a later approved migration. |
| Same parent/child in multiple schools simultaneously | Global unique(parentId,studentId) permits one link for that pair, not one per school. A parent with different children at different schools is supported now. Multiple school links for the same child need a deliberate uniqueness/history migration. |
| Multiple active sections per student/year | Schema permits them. Phase 1 does not silently impose a one-section-per-year rule. All valid ACTIVE enrollments are included. Overlapping semesters are likewise not forbidden by the schema/API. |
| Global identity editing from each school | Global email/active/password are not school profile fields. No ordinary School Admin can globally deactivate an identity or overwrite another school's shared identity. Owner name/language edits are implemented; email verification/password reset and delegated profile-edit policy are deferred. |
| Refresh selected context | RefreshToken has no membership/session columns. The opaque token carries AES-256-GCM encrypted membership UUID plus randomness; only its hash is stored. Rotation preserves exactly that membership and fails if unavailable. A future session table could support token-family/device management. |
| Activity/auditing, notifications, lessons, assessments, grades | Not part of this phase. Existing frontend simulations stay intact; do not claim their events or result workflows have been persisted by Phase 1. |

The database has missing relational protections worth addressing later:
ParentStudentLink.schoolId lacks a School FK; SectionSubject.teacherId and
Enrollment.studentId are UUIDs without User FKs; several schoolId columns lack
School FKs; cross-school consistency of composite references is not enforced by
the existing single-column FKs. Phase 1 services check these relationships for
both adapters, but this is not a substitute for later constraints and RLS review.
PostgreSQL nullable uniqueness also needs review for PLATFORM_ADMIN memberships;
no public platform-role creation endpoint is provided here.
