# Files, announcements and in-app notifications

This update adds actual authenticated file upload/download, announcement
publication and durable notification records to the existing API. It builds on
assessment/submission/result release without connecting the frontend demos.

## Actual files

`POST /api/v1/files` accepts multipart form data with one `file` plus:

| Purpose | Target | Who can upload? |
| --- | --- | --- |
| `LESSON_RESOURCE` | `lessonId` only | School admin or assigned teacher, in an unarchived year and DRAFT lesson |
| `ASSESSMENT_ANSWER` | `assessmentId` only | Eligible enrolled student, while OPEN, before final submission, with at least one FILE_UPLOAD question |

The fixed maximum is **10 MiB**, with one nonempty file per request. Supported
extensions/MIME types are PDF, PNG, JPEG, UTF-8 TXT and Office Open XML DOCX/XLSX/PPTX.
The API validates the filename extension, declared MIME and a basic format
signature (Office files require a ZIP signature). This is not a full document
parser or malware scan. HTML, SVG, executables, legacy Office binaries and general
archives are not accepted. Original filenames are sanitized for metadata and
attachment headers; storage keys are generated exclusively by the server.

An upload returns FileDto with id, schoolId, ownerId, purpose, lessonId/assessmentId,
storageKey, originalName, contentType, size and createdAt. Provider credentials,
local paths and private storage configuration never appear in responses.

The bytes are written first; the API then revalidates current permissions and
lifecycle in a fresh tenant transaction and creates FileObject metadata. Failure
to persist metadata triggers cleanup of the new object. The database retry loop
does not repeat external writes. If cleanup itself fails, a warning is logged;
maintenance should reconcile unreferenced objects rather than exposing them.
No endpoint overwrites or publicly serves a storage key.

### Attaching and downloading

- To attach a lesson file, create/update a FILE resource using the returned
  `storageKey` and the same `lessonId`. The API rejects arbitrary, foreign,
  nonexistent and unrelated keys. Teachers must use their own uploads.
- To answer a FILE_UPLOAD question, use the returned `storageKey` as `fileKey` in
  the existing save/submit request. The file must have an actual server upload
  record owned by the current student for the exact assessment.
- `GET /files/:id` returns authorized metadata.
- `GET /files/:id/content` returns the actual bytes as an attachment with
  `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
  Size and SHA-256 are verified before bytes are returned, followed by a second
  authorization check after retrieval. No public static directory or permanent
  object URL is exposed.

| File | Download rules inside the selected school |
| --- | --- |
| Lesson file | Admin/assigned teacher can read it. An enrolled student or verified linked parent requires a PUBLISHED lesson and a FILE resource referencing that object. Unattached/draft files remain private. |
| Student answer | The owning eligible student can read it. Admin/assigned teacher requires a final submission referencing the file. An approved parent additionally requires released results and an active child enrollment. Other students cannot read it. |

All requests recheck current school/account/membership and relationship state.
Revoked parent links, withdrawn enrollment and reassigned teachers lose access.
Parent file/announcement/notification requests use their selected school context;
parents can switch to another active school membership with the existing auth API.
The existing cross-school child overview/grades endpoints keep their behavior.

Legacy fictional resource metadata is not silently treated as uploaded bytes.
A legacy key needs an actual new upload before attaching/updating it as a FILE
resource. Existing metadata does not create FileObject records or downloadable data.

### Object storage

Development defaults to `WASL_FILE_STORAGE_DRIVER=local`, using a private
`WASL_FILES_DIR` (default `.wasl-data/files` under the API working directory).
The directory is ignored by git. Bytes persist across provider/API instances
when the same directory is retained; memory metadata still resets on restart.
Use persistent Prisma metadata plus a persistent object store for a real environment.

Production requires `WASL_FILE_STORAGE_DRIVER=s3` with:

```dotenv
S3_REGION=us-east-1
S3_BUCKET=wasl-private
S3_ACCESS_KEY_ID=<private server credential>
S3_SECRET_ACCESS_KEY=<private server credential>
# For MinIO/custom S3, supply an endpoint and path-style configuration:
S3_ENDPOINT=https://objects.example.test
S3_FORCE_PATH_STYLE=true
```

Create a private bucket and provision least-privilege credentials separately.
The API checks bucket accessibility at startup/readiness; it does not create a
bucket, enable public access or fall back to local storage. Production custom
endpoints must use HTTPS. For local MinIO, HTTP is permitted in development.
The AWS SDK v3 implements conditional immutable writes, reads and cleanup.
Downloads are proxied through authenticated API requests so relationship
revocation is checked on every access; signed object URLs are not exposed here.
Uploads/downloads are bounded and buffered up to 10 MiB per request; larger video
or multipart/direct-upload support is separate work.

## Announcements

School admins can publish school-wide or class announcements. Teachers can create
announcements only for currently assigned classes and manage their own class
announcements. School admins can moderate announcements inside their school.

The lifecycle is `DRAFT → PUBLISHED → ARCHIVED`. Only drafts can be edited;
class/author/school identifiers are immutable after creation. Published and
archived content stays in storage. Drafts/archives are visible to authorized
staff only; student and parent views show published announcements only.
A class announcement is restricted to the assigned teacher, enrolled students
and verified linked parents. A school-wide announcement is available to current
active school memberships. Archived-year class authoring/publication is blocked.

| Method | `/api/v1` path | Input / purpose |
| --- | --- | --- |
| GET | `/announcements` | Paginated search; optional sectionSubjectId/status |
| GET | `/announcements/:id` | Authorized detail |
| POST | `/announcements` | title, body, optional sectionSubjectId (null means school-wide) |
| PATCH | `/announcements/:id` | Draft title/body |
| POST | `/announcements/:id/publish` | Publish and create notification records atomically |
| POST | `/announcements/:id/archive` | Preserve record and remove it from student/parent feeds |

Authored title/body content follows the schema's existing single-string fields;
it may be Arabic or English. The server does not invent translations of content.

## In-app notifications

| Event | Recipients |
| --- | --- |
| Announcement published | School-wide: active memberships except publisher. Class: eligible students and verified parents except publisher. |
| Assessment published/scheduled | Eligible enrolled students and verified parents. Notifications link to safe assessment metadata; scheduled question content remains hidden. |
| Final submission received | Assigned active teacher and submitting student. Saving a draft does not notify. |
| Results released | Graded students who remain eligible and their verified parents. Marking before release does not notify. |

Notifications are stored in the same transaction as the triggering state change.
Failures roll back both. Deterministic IDs deduplicate each entity/type/recipient/
child; repeated requests do not create duplicate delivery. A newly published
assessment which is unpublished then republished reuses existing event records
for those recipients rather than resetting read flags.

Responses include a type, minimal entity/class/child identifiers, bilingual system
titles (`title`/`titleAr`), createdAt and nullable readAt. They contain no answer
keys, scores or feedback. Notification reads revalidate current source access,
so revocation/withdrawal/reassignment, an unpublished assessment or an archived
announcement removes related entries from lists and unread counts.

| Method | `/api/v1` path | Purpose |
| --- | --- | --- |
| GET | `/notifications` | Current user's current-school notifications; page/limit/search/sort/order and read=all/read/unread |
| GET | `/notifications/unread-count` | Count of currently visible unread notifications |
| PATCH | `/notifications/:id/read` | Mark own visible item read, preserving the first read timestamp |
| POST | `/notifications/read-all` | Mark all own currently visible unread items read |

Clients cannot create notifications, choose a recipient or modify another user's
read state. These are in-app records read through the API. FCM/device push,
email/SMS delivery, background reminders and delivery retries are not included.
The Platform Admin has no school-scoped notification feed in this phase.

## Persistence and migrations

FileObject is an additive table with school/owner/target relations, immutable key,
MIME, byte size, SHA-256 and provider identifier. Announcements gain status and
publishedAt. Notification uses its existing schema with a typed minimal payload.
All adapters implement the same contracts and service rules.

The repository previously had no migration history. This update supplies a
baseline matching the previous main schema and a separate feature migration.
The feature SQL adds target/size/provider/hash checks and FORCE RLS policies for
file_objects, announcements and notifications. It conditionally grants runtime
access to an existing `wasl_app` role; it does not provision database credentials.

**Do not apply the baseline blindly to an existing database.** Compare its schema,
review migration baselining/backups and follow [the database handoff](database-handoff.md).
The rest of the baseline's tables still need the broader RLS/grants/constraints
review before deployment. Prisma generation/typechecking and memory tests do not
prove live PostgreSQL migrations or RLS. No live database or private S3/MinIO
instance is provisioned or modified by this implementation.

## Verification

API tests upload and retrieve real temporary filesystem bytes, exercise private
lesson/answer access, ownership/target/lifecycle checks, validation and limits,
cleanup and reauthorization, event delivery/rollback/deduplication and notification
read-state isolation. The shared client is tested over real HTTP with multipart
upload and binary download. Object-store tests cover filesystem persistence and
S3 command/error/stream handling with a simulated SDK client.

Live S3/MinIO connectivity and PostgreSQL migration/RLS/concurrency still require
verification in the selected real environment. Frontend source remains on the
existing demo repositories until integration is requested.

Verified in this update: 121 tests pass across six API/object-store suites,
including 27 new file/communication tests. Shared package build/typecheck,
Prisma 6.9.0 client generation, API typecheck/Nest build and web typecheck pass.
