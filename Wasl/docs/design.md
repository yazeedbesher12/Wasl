# Wasl: System Design

Oct 31, 2026

## Overview and scope

Wasl is a multi-school learning platform for students, teachers, parents, school admins and platform admins, built as one backend API serving a web app and a mobile app, plus a separate AI service. We build it in three releases so there is always a working, demo-able system.

| Release | What it delivers | Done when |
| --- | --- | --- |
| R1: Core (MVP) | Schools, academic structure, users and roles, lessons and resources, assignments, exams and question banks, submissions, grading, parent view, announcements | A teacher publishes a lesson and an assignment, a student submits from mobile, the teacher grades it, and the parent sees the result |
| R2: Learning support | Attendance and viewing progress, skills linked to questions, student skill map, rule-based learning paths, catch-up plans, early support alerts, assessment scheduling alerts | A student who misses a week gets a catch-up plan, and the teacher gets an alert |
| R3: Offline and AI | Offline downloads and sync on mobile, AI tutor with source-linked answers, AI draft questions and rubrics for teachers, digital portfolios | A student practises offline, syncs later, and asks the AI about a lesson |

Out of scope unless the supervisor asks: live video classes (we link to Zoom or Meet instead), payments, and a public course marketplace.

## Roles and permissions

Five roles, checked on every API call: a user's role applies inside one school, except platform admins (all schools) and parents (only their linked children, possibly across schools).

| Capability | Platform admin | School admin | Teacher | Student | Parent |
| --- | --- | --- | --- | --- | --- |
| Create and suspend schools | Yes | No | No | No | No |
| Manage years, grades, sections, subjects | No | Yes | No | No | No |
| Enroll students, assign teachers | No | Yes | No | No | No |
| Verify and link parent accounts | No | Yes | No | No | No |
| Publish lessons, resources, assignments, exams | No | No | Own sections | No | No |
| Grade and release results | No | No | Own sections | No | No |
| Define skills and learning-path rules | No | No | Own subjects | No | No |
| Take lessons, submit work, use AI tutor | No | No | No | Own | No |
| See attendance, grades, schedule | Aggregate | Whole school | Own sections | Own | Linked children |
| Post announcements | Platform-wide | School-wide | Own sections | No | No |
| Academic reports | Platform stats | Whole school | Own sections | No | No |

One person can hold several roles (a teacher who is also a parent), so roles live in a membership table, not on the user record.

## Tech stack and architecture

Web and mobile talk only to the backend API; the API alone touches the database, files and the AI service, so permissions are enforced in one place.

See the deployment diagram in [uml/08-deployment.png](uml/08-deployment.png).

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | NestJS (TypeScript), Prisma ORM | Modular structure matches the abstract's "modular backend"; strong typing shared with the apps |
| Database | PostgreSQL 16 with Row-Level Security and pgvector | Relational data, built-in tenant isolation, and AI search in the same database |
| Web | Next.js (React), Tailwind CSS | Responsive web for all roles, Arabic right-to-left supported |
| Mobile | React Native with Expo, SQLite for offline | One codebase for Android and iOS, same language as the web |
| AI | Python FastAPI, an LLM API, embeddings | Python has the best AI libraries; isolated so it can't touch other data |
| Files | MinIO locally, S3-compatible storage in production | Signed URLs, per-school folders |
| Jobs | Redis with BullMQ | Nightly alerts, notifications, AI indexing |
| Hosting and CI | Docker Compose, GitHub Actions | One command to run everything; tests on every pull request |

## Multi-school data isolation

All schools share one PostgreSQL database, and every school-owned table carries a `school_id` that is enforced twice: in the API and in the database itself.

1. **Shared schema, `school_id` column.** Simpler to build and migrate than one database per school, and it lets a parent see children in two schools.
2. **API layer.** A request guard reads the user's active school from the JWT and the membership table, and every repository query is scoped by it. No endpoint accepts a `school_id` from the client without checking membership.
3. **Database layer.** PostgreSQL Row-Level Security policies filter rows by a per-request `app.school_id` setting, so a missed filter in code still cannot leak data.
4. **Files.** Object keys are prefixed `schools/{school_id}/...` and served only through short-lived signed URLs.
5. **Tests.** An automated test suite logs in as users of school A and tries to read and write school B's data on every endpoint. This is the "cross-school access isolation" evaluation from the abstract.

Parents are the one cross-school case: a `parent_student_link` row, approved by each child's school admin, grants read access to that child only.

## Database model

About 40 tables in eight modules; R1 needs the first five. Every table except those in Identity has `school_id`, and records are archived, never deleted, so past years stay intact.

| Module | Main tables | Release |
| --- | --- | --- |
| Identity | users, schools, memberships (user, school, role), parent\_student\_links, refresh\_tokens | R1 |
| Academic structure | academic\_years, semesters, grades, sections, subjects, section\_subjects (section + subject + teacher), enrollments (student + section + year), units, lessons, timetable\_slots | R1 |
| Content | resources (file, video, link), lesson\_resources, file\_objects | R1 |
| Assessment | question\_banks, questions, question\_options, assessments (assignment or exam), assessment\_questions, submissions, answers, grades, feedback | R1 |
| Communication | announcements, discussions, discussion\_posts, notifications, devices (push tokens) | R1 |
| Tracking | attendance\_records, online\_class\_sessions, online\_attendance, lesson\_view\_progress | R2 |
| Learning support | skills, skill\_prerequisites, question\_skills, student\_skill\_scores, path\_rules, learning\_path\_items, catch\_up\_plans, catch\_up\_items, support\_alerts, intervention\_plans | R2 |
| Offline and AI | sync\_operations, portfolio\_items, ai\_documents, ai\_chunks (pgvector embeddings), ai\_conversations, ai\_drafts | R3 |

Key relationships: a **section** belongs to a grade in one academic year; a **section\_subject** ties a teacher to a subject in a section, and lessons, assessments and attendance all hang off it. A **submission** links a student to an assessment, and each **answer** is scored per question, which is what feeds the skill map through **question\_skills**.

The full ER diagram can be generated from `apps/api/prisma/schema.prisma`, so it always matches the code.

## API outline

One versioned REST API at `/api/v1`, documented automatically with OpenAPI (Swagger) and shared by web and mobile. School-scoped routes take the school from the token, not the URL.

| Area | Main endpoints |
| --- | --- |
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/switch-school`, `GET /me` |
| Platform admin | `GET/POST /admin/schools`, `PATCH /admin/schools/:id` |
| School setup | `/academic-years`, `/grades`, `/sections`, `/subjects`, `/sections/:id/subjects`, `/enrollments`, `/users` (invite, import CSV) |
| Content | `/units`, `/lessons`, `/lessons/:id/resources`, `POST /files/upload-url` |
| Assessment | `/question-banks`, `/questions`, `/assessments`, `POST /assessments/:id/publish`, `/assessments/:id/submissions`, `POST /submissions/:id/grade`, `POST /assessments/:id/release` |
| Student | `GET /me/subjects`, `/me/schedule`, `/me/tasks`, `/me/grades` |
| Parent | `GET /parent/children`, `/parent/children/:id/overview`, `/attendance`, `/grades`, `/schedule` |
| Communication | `/announcements`, `/discussions`, `/notifications`, `POST /devices` |
| Tracking (R2) | `/attendance`, `POST /lessons/:id/progress` |
| Learning support (R2) | `/skills`, `/path-rules`, `GET /students/:id/skill-map`, `/catch-up-plans`, `/alerts`, `/interventions` |
| Sync (R3) | `GET /sync/pull?since=`, `POST /sync/push` |
| AI (R3) | `POST /ai/tutor/ask`, `POST /ai/teacher/draft-questions`, `/ai/teacher/summary`, `/ai/teacher/rubric` (proxied to the AI service) |

Requests and responses use JSON with DTO validation, list endpoints page with `?page=&limit=`, and errors share one shape (`code`, `message`, `details`).

## Offline sync, learning support and AI

These are the three parts that make Wasl different from a plain LMS, and each has a simple first version that can grow.

**Offline sync (mobile only).** The Expo app stores downloaded lessons, resources and practice sets in SQLite and the file system. Student actions taken offline (answers, submissions, viewing progress) go into a local outbox with a client-generated ID. On reconnect the app calls `/sync/push` (the server ignores IDs it already has, so retries are safe) and then `/sync/pull?since=` for changes. Conflicts are rare because students only write their own work; the rule is that the server copy wins after a deadline closes.

**Learning support (rule-based, no AI needed).**

- Each question is tagged with one or more skills. After grading, a student's score per skill is updated as a weighted average, giving the skill map (weak, developing, mastered).
- Teachers write rules like "if skill score is below 50%, assign the foundation explanation and 5 practice questions". The rules engine turns them into learning path items.
- A catch-up plan takes missed lessons and tasks, orders them by skill prerequisites, and spreads them over the student's available days until the teacher-approved deadline.
- A nightly job raises support alerts for repeated absences, overdue work or a falling average, which the teacher reviews and turns into an intervention plan.

**AI service (Python FastAPI).** It answers only from approved course material (retrieval-augmented generation):

1. When a teacher publishes a resource, its text is split into chunks, embedded and stored in PostgreSQL with pgvector, tagged with school and subject.
2. A student question retrieves the closest chunks from that student's own subjects only, and the language model answers with links to the source lesson. Tutor mode gives hints, not full answers to graded work.
3. Teacher tools draft questions, summaries and rubrics that are saved as drafts and are never published without the teacher's review.

The LLM provider is called only from the AI service, behind a single interface so it can be swapped. Usage is logged per school to control cost.

## Repo layout and next steps

Everything lives in one monorepo, [yazeedbesher12/Wasl](https://github.com/yazeedbesher12/Wasl), managed with pnpm workspaces and Turborepo so the TypeScript apps share types.

```
Wasl/
  apps/
    api/        NestJS backend + Prisma schema and migrations
    web/        Next.js web app (all roles)
    mobile/     Expo React Native app (students and parents first)
    ai/         Python FastAPI AI service
  packages/
    shared/     shared TypeScript types, API client, validation
    ui/         shared design tokens
  infra/        docker-compose (Postgres + pgvector, MinIO, Redis)
  docs/         this design, ER diagram, API docs
  .github/      CI: lint, test, build on every pull request
```

Step 2 (skeleton) will deliver:

- [ ] Monorepo with the four apps running locally through one `docker compose up`
- [ ] Prisma schema for the R1 tables, first migration, seed data (2 schools, all five roles)
- [ ] Login, refresh tokens, role guard, school scoping and Row-Level Security
- [ ] Web and mobile login screens calling the real API
- [ ] CI on GitHub Actions and the cross-school isolation test suite started

Open questions for you:

- [ ] What is the deadline for the first demo and the final submission?
- [ ] Is the interface Arabic, English, or both (right-to-left support)?
- [ ] Does Dr. Arandi require a specific document format (SRS, UML diagrams)?

Answers so far: the interface is bilingual, Arabic and English with right-to-left layout; the deadline is open for now; the design is documented in UML (use case, class, sequence, activity, state and deployment diagrams) in UML design.

## Current frontend demonstration stage

Current backend decision: implement the backend now and connect PostgreSQL later.
Phase 1 adds database-independent auth, schools/identity, academic structure and
approved Parent reads with development memory and implemented Prisma adapters.
See [backend Phase 1](backend-phase1.md), [schema/API mapping](backend-schema-mapping.md)
and [database handoff](database-handoff.md). Frontend apps still use their existing
demo repository. Prisma, database behavior and RLS have not been runtime-verified.

Frontend-first work now provides Platform Admin web plus School Admin, Teacher, Student and Parent workspaces on web and native mobile, backed by a shared local demo repository. This is a temporary frontend adapter, not a change to the production architecture, Prisma model or API contracts above. Database selection and backend integration remain deferred. See [the connected frontend guide](frontend-demo.md) for implemented workflows, relationship mapping, versioned preservation of previous demo data, explicit snapshot transfer and manual review steps. See [the Student/Parent demo guide](student-parent-demo.md) for enrollment-based access, approved cross-school child context, answer drafts/final submissions and explicit result release. No timetable data exists in this frontend stage; schedule remains deferred.
