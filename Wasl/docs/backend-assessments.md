# Assessment, submission and results backend

Implemented on top of the existing Release 1 Prisma schema. The API and shared
`WaslClient` now cover assignments/exams, student drafts and final submissions,
manual marking and explicit result release. Web/mobile screens still use their
local demo repositories; this change does not connect or migrate those snapshots.

## Authorization and history

- The **assigned teacher** creates/edits/publishes assessments, closes them,
  grades final work and releases results. School admins have school-wide read
  access, including final submissions, but cannot publish or grade.
- Students only see assessments in sections with their own ACTIVE enrollment.
  DRAFT assessments are hidden. School and student IDs on writes come from the
  current authenticated actor. Every operation rechecks active membership,
  school availability and current relationships in its storage transaction.
- Parents only read released grades for their own currently VERIFIED child
  links. Link discovery is followed by a second tenant-scoped check of the link,
  school, parent membership and child membership; parent reads never use bypass.
  An optional `schoolId` only selects among approved links.
- Other schools, unassigned teachers and other students' submissions return 404.
  Student drafts are private until final submission, including from staff reads.
- An archived academic year prevents new assessment, answer or marking writes.
  Existing released results remain readable for currently eligible readers.
  No assessment/submission deletion or history rewrite endpoint is provided.

## Lifecycle

`DRAFT → SCHEDULED/OPEN → CLOSED → GRADING → RESULTS_RELEASED → ARCHIVED`

Opening and deadline transitions are derived on **every read and write** using
server time; no cron or background worker is needed. Stored SCHEDULED/OPEN values
can therefore remain unchanged until a later write, while API `status` reports
the effective state. A draft is the only editable assessment state. `opensAt` and
`dueAt` are nullable ISO timestamps that must include Z or an explicit timezone
offset. If both exist, the deadline must follow the opening time; publishing with
a deadline in the past is rejected. A null deadline requires manual closure.

Only questions from banks for the assessment's subject and school may be linked.
`PUT .../questions` replaces the complete ordered draft list (at most 200 entries,
unique question IDs and order values). At least one question is required to
publish. Published references lock question content/options/points in both
storage adapters. Unpublish is allowed only while SCHEDULED/OPEN and **no student
record exists**, including an empty draft. Questions stay locked if any other
non-draft assessment still references them.

Students see scheduled assessment metadata but no question text/options before
`opensAt`. The generic `/student/questions` routes follow the same eligibility
rule: questions must belong to an eligible non-draft assessment whose opening
time has arrived. Unused draft-bank questions are hidden. Student responses never
contain `isCorrect`; SHORT_ANSWER model-answer options are also omitted entirely.
Questions already shared through a different open assessment remain visible
there; use distinct questions when an exam must contain previously unseen items.

## HTTP API

All paths below are relative to `/api/v1`. List responses are
`{ items, total, page, limit }` with the existing search/order/page validation.

| Method | Path | Role / purpose |
| --- | --- | --- |
| GET | `/assessments` | Teacher own classes, school admin, or enrolled student; filters: sectionSubjectId/type/effective status |
| POST | `/assessments` | Teacher creates DRAFT: sectionSubjectId, type, title, optional instructions/opensAt/dueAt |
| GET | `/assessments/:id` | Author detail for staff; safe question projection for students |
| PATCH | `/assessments/:id` | Assigned teacher edits draft fields; class relationship is immutable |
| PUT | `/assessments/:id/questions` | Assigned teacher replaces `{ questions: [{ questionId, order }] }` |
| POST | `/assessments/:id/publish` | Publish now or schedule |
| POST | `/assessments/:id/unpublish` | Return eligible unused assessment to draft |
| POST | `/assessments/:id/close` | Manually close SCHEDULED/OPEN; also accepts effective CLOSED |
| POST | `/assessments/:id/start-grading` | CLOSED → GRADING; grading the first submission also performs this transition |
| POST | `/assessments/:id/release` | Release every final result together |
| POST | `/assessments/:id/archive` | Archive a released assessment |
| GET | `/assessments/:id/submission` | Student resumes own draft or reads own receipt |
| PUT | `/assessments/:id/submission` | Student replaces own draft answers |
| POST | `/assessments/:id/submit` | Student submits complete final answer set |
| GET | `/assessments/:id/submissions` | Assigned teacher or school admin; excludes drafts; filters: studentId/status |
| GET | `/submissions/:id` | Authorized staff or owning student, with result visibility rules |
| POST | `/submissions/:id/grade` | Assigned teacher saves complete per-question marking |
| GET | `/me/tasks` | Student assessment list alias |
| GET | `/me/grades` | Student's released results only |
| GET | `/parent/children/:id/grades` | Approved child's released results; optional schoolId |

Creation returns HTTP 201; actions and saves return 200. Invalid inputs return 400,
unavailable records 404, forbidden roles 403 and invalid lifecycle/concurrent
changes 409. Swagger documents the new request/response models.

## Answer and marking contracts

Both draft save and final submit accept **complete replacement**:

```json
{
  "answers": [
    { "questionId": "<choice-question-uuid>", "optionId": "<option-uuid>" },
    { "questionId": "<written-question-uuid>", "text": "Student's own answer" }
  ]
}
```

- Choice/true-false answers require exactly one valid option ID from that question.
  Short/essay answers use `text`. Drafts can be partial or cleared with `[]`.
  Final submission requires every question answered, including nonblank text.
- The server checks OPEN status after validating the answer set. At `now >= dueAt`
  both draft and final writes stop. There is no late allowance, resubmission or
  offline synchronization endpoint in this phase; schema LATE/clientId fields
  are preserved without inventing a new policy.
- Submission ID and answer IDs are retained when replacing a draft. Final
  submission cannot be edited. The unique assessment/student pair plus serialized
  memory operations / Serializable Prisma operations prevents duplicate finals;
  retries after a successful final return 409 and clients can GET the receipt.
- FILE_UPLOAD answers accept **metadata only** in `fileKey`, under
  `schools/{current-school-uuid}/students/{current-student-uuid}/...` with path
  traversal and foreign namespace checks. This does not upload or verify a
  physical object and provides no download URL. File upload ownership/existence
  verification must be added with the future signed-upload service before treating
  file metadata as proof that work was uploaded.

Marking is manual for all supported question types. It requires a CLOSED/GRADING
assessment and a final submission:

```json
{
  "answers": [
    { "questionId": "<question-uuid>", "score": 2 }
  ],
  "feedback": "Teacher's feedback"
}
```

Every submitted question requires one finite score between zero and its question
maximum. The total is derived by the server; clients cannot set a submission total,
student identity, school, grading date or release state. Invalid marking rolls back
as a whole. Teachers may revise marking until release. Release requires at least
one final submission and all finals GRADED; abandoned IN_PROGRESS drafts do not
block release. No submissions are accepted during grading or after release.

Until explicit release, student receipt/list projections return null for total,
answer scores, feedback and gradedAt, and show GRADED as SUBMITTED. Parent grade
lists omit unreleased work entirely. After release, student and approved parent
see marks/feedback; marking and questions become immutable. Archived released
assessments retain that visibility.

## Storage and verification

Memory and Prisma use the same services, rules and repositories. The memory
adapter derives question locks from real assessment-question relationships;
fictional development assessment IDs are `developmentId(801)` / `(802)`.
Prisma operations stay inside the existing tenant-scoped Serializable transaction,
including question replacement, final submission and marking. The existing
schema is unchanged and no migrations/database provisioning are performed here.

Automated coverage includes the complete teacher/student/parent workflow, exact
opening/deadline boundaries, stale-token membership and relationship changes,
question/answer validation and rollback, concurrent final submission, mark
bounds, release gating, grade and model-answer redaction, cross-school and peer
isolation, Swagger generation and a real HTTP call through the shared client.

Validation commands from the nested `Wasl` workspace:

```sh
pnpm --filter @wasl/shared build
pnpm --filter @wasl/api exec prisma generate
pnpm --filter @wasl/api typecheck
pnpm --filter @wasl/api build
pnpm --filter @wasl/api test
```

These checks generate/typecheck the Prisma client and execute the API against
memory. They do **not** prove live PostgreSQL constraints, migration history,
RLS/grants, pool isolation or database concurrency. Those remain in
[the database handoff](database-handoff.md). Frontend integration, signed binary
uploads, automatic grading, notifications and AI remain separate work.

### Verification result (2026-11-22)

- Shared package build/typecheck, API typecheck and Nest build pass with the
  generated Prisma 6.9.0 client.
- The API memory suite passes 94 tests (72 existing + 22 assessment workflow
  tests).
- Web typecheck passes. Mobile typecheck reports the existing
  `apps/mobile/src/education.tsx:71` use of `StyleSheet.absoluteFillObject`, which
  React Native 0.88.1 no longer exposes in its types. The same error was reproduced
  against the unchanged base commit `cc35338`; no frontend source was changed.
