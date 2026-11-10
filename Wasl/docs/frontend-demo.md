# Connected Wasl frontend demo

This stage implements Platform Admin on web and School Admin, Teacher, Student and Parent on both Next.js web and native React Native / Expo. See [the Student/Parent extension guide](student-parent-demo.md) for learner workflows and the current v3 snapshot format. Production API integration, database choice and authentication are deferred. Prisma and production API contracts are unchanged.

## Launch

Use the workspace root, **not** its parent Git root:

```powershell
cd D:\Desktop\Wasl\Wasl
npx.cmd --yes pnpm@10.28.0 install
npx.cmd --yes pnpm@10.28.0 --filter @wasl/web dev
```

Open `http://localhost:3000/demo` for the explicitly labeled demo membership selector. `/admin` still opens Platform Admin, with its existing actions and a link to school/teacher workspaces. The root URL still redirects to `/admin`.

For native mobile, open another terminal:

```powershell
cd D:\Desktop\Wasl\Wasl
npx.cmd --yes pnpm@10.28.0 --filter @wasl/mobile start
```

Scan the Expo QR code using a compatible Expo Go Android app, or with an Android emulator/device configured:

```powershell
npx.cmd --yes pnpm@10.28.0 --filter @wasl/mobile android
```

These commands are derived from the current package scripts (`next dev -p 3000`, `expo start`, `expo start --android`). Node must satisfy the existing Expo 58 / React Native 0.88 toolchain: the lockfile declares Node `^22.13.0 || ^24.3.0 || >=26.0.0` for React Native. No API, database, credentials or environment variables are needed. Native Android execution and APK generation have not been performed.

## Entry and workflows

Select an active school, then a School Admin, Teacher, Student or Parent membership. No login, invitation, password or production session is simulated. The first teacher (`Lina Ahmad / لينا أحمد`) in each populated seeded school has a mathematics assignment. Other teachers demonstrate empty assignment states. A new school created through Platform Admin receives an administrator membership and an empty academic workspace.

School Admin navigation covers dashboard, users/memberships, academic structure, parent links, announcements, notifications, settings and snapshot transfer. Academic structure includes years, semesters, grade levels, sections, subjects, teacher assignments, student enrollments and the current-year preference. Open a record to edit it or use safe lifecycle actions. Reuse a person by selecting an existing identity or by entering an existing email; the service prevents duplicate school/role memberships. Existing people retain one shared identity. No records are permanently deleted.

Teacher navigation covers dashboard, assigned classes, units, lessons, resources, question banks, questions, assessments, submissions, gradebook, announcements, notifications and snapshot transfer. Native primary tabs keep Dashboard, Classes/Users, Submissions/Academics and More manageable; More exposes the remaining native screens. Android hardware back uses a local navigation stack. Forms use keyboard avoidance and safe-area insets.

Create a question bank for an assigned class, then create multiple-choice, true/false or short-answer questions. Create a draft assessment, open its detail and add assessment-question relationships. The assessment detail is the readable preview, with question count and total marks derived from the linked bank questions. Deadlines and opening times require ISO timestamps **with a timezone**, such as `2027-01-20T15:00+02:00`; choose a future deadline when publishing.

Published/closed assessments and referenced questions are protected from destructive editing. Lessons and announcements are edited as drafts, then published. Archiving keeps historical records. Academic parent records with active dependencies must be deactivated from the leaves first; class archiving preserves its teaching content and makes removed teacher assignments unavailable.

Seeded `Fraction check / تقييم الكسور` assessments are closed and have three submissions from actual enrolled students. Open a submission, inspect its answers, enter per-question scores/feedback, save a partial or complete grading draft, and explicitly release a completely graded result. Partial marks remain incomplete and missing grades are never zero. Released scores and timestamps remain immutable records used by the Student/Parent result views. The gradebook also shows enrolled students who have not submitted.

For the requested connected scenario, an administrator can create a new Teacher membership and reassign the seeded mathematics class to that teacher. The new teacher immediately sees the existing class, roster, lessons, assessment and valid seeded submissions in the same app. A newly created class has an empty submission list, since no Student submission UI is in scope.

## Shared data and migration

`packages/shared/src/demo` is the single platform-neutral source of models, fixtures, localized messages, form definitions, permissions, lifecycle rules, relationships, derived totals and snapshot validation. It does not import React, React Native, browser storage or backend services. The flexible demo records are a frontend model, not new production DTOs. Relationships use stable IDs. The existing API-compatible school fields remain intact, with additional demo metadata nested under `school.demo`.

The previous `wasl.platform-demo.v1` browser key is retained, with a version-3 document inside it. Existing v2 documents receive an additive answer-draft migration; see the extension guide for quota-aware backup behavior. Valid v1 schools, contacts, statuses, platform profile and activity are retained. A `.backup-v1` copy is written before migration replaces the document. Existing aggregate student/teacher counts are materialized as fictional people and memberships, so Platform Admin and School Admin totals agree. The seeded section enrolls up to 24 of those students; remaining school memberships are available for enrollment. Stable fixture IDs allow the same fixture relationships on both platforms. No separate per-role school arrays exist.

The web adapter lives in `apps/web/src/lib/admin/repository.ts`. Existing Platform Admin repository methods delegate to the same store. School mutations and teaching changes notify subscribers immediately inside that application. Cross-tab and cross-device storage are **not synchronized**. On native, AsyncStorage is the persistence adapter; snapshots are chunked below Android's per-row storage limit, and a manifest is written last so interrupted writes preserve the previous complete snapshot.

Malformed, unsupported or relationally broken saved snapshots are preserved unchanged and show a recovery error. They are never silently reset. The demo selector includes validated import recovery. Storage write failures keep the current session available with a warning; export before closing if storage is full or unavailable. The explicit Platform Admin reset confirmation now states that school, teaching and grading work is included in the reset.

Browser-only storage is accessed after mounting. SSR starts with the Arabic loading shell, avoiding browser globals during rendering. All domain mutation entry points check the current active school, membership and assignment. Import/export is an intentionally global **demo transport** and includes all schools; this is not a production authorization mechanism.

## Snapshot transfer

On web, use Transfer (or the demo selector) to download a `.json` snapshot, select a JSON file or paste JSON. As a demo operator on native, use demo entry or More → Transfer in a staff workspace to export a cached JSON file through the native share sheet and import through the system document picker; pasting JSON is also supported. Transfer the exported file to the other device yourself. Export never sends a file to a destination automatically.

Both apps decode and validate the same versioned envelope, including foreign keys, school boundaries, role relationships, assessment-question compatibility, enrollments, marks and released results. Replacement requires confirmation. Existing local data is backed up under `.before-import` when storage permits; export your current snapshot before replacement. Unsupported versions and broken relationships do not change current records. Successful import clears stale membership/UI selections and returns to the demo selector while preserving language.

## Localization and visual design

The supplied visual description of [the reference](https://www.studentactivity.software/) guided the cool-gray background, white surfaces, royal-blue actions/selected states, bold dark headings, pale icon backgrounds, 18px content cards and 12px controls. No branding, imagery, marketing copy, event or points workflows were copied. The reference URL returned no readable page content during an additional read-only fetch; no visual/browser runtime review was performed.

Arabic is the default. Both apps expose عربي / English, translate navigation, validation, lifecycle states, alerts and feedback, and use Intl for dates/numbers. Web switches the document language and direction and mirrors the sidebar. Switching language preserves the current route, selections, filters and entered drafts. Native also remembers navigation/filter/form UI state locally and configures I18nManager; a visible notice explains when the native app must be restarted/reloaded for system RTL direction to fully take effect. Native layout/text direction is explicit in the current screen. Dates display in Asia/Jerusalem. System fonts provide Arabic and Latin coverage without font network requests.

Five native dependencies were necessary because the scaffold had no persistence, inset or transfer support: AsyncStorage for persistence; safe-area-context for device insets; Expo FileSystem, DocumentPicker and Sharing for complete JSON file transfer without clipboard-size limits. FileSystem was already present transitively and is now declared directly. Versions follow the current Expo documentation. The pnpm lockfile was refreshed using `install --lockfile-only --ignore-scripts`; application dependencies were not installed or executed. That resolution reported existing React/react-dom and webpack peer mismatches outside this change; no unrelated upgrades were made.

## Manual checks — not executed

1. With an existing v1 browser demo, open `/admin` then `/demo`: verify prior custom schools, contacts, statuses and activity remain, counts are retained, and a `.backup-v1` copy exists. Add a zero-count school and enter its School Admin empty workspace.
2. In **both web and native**, select School Admin for Al Nour. Search/filter users. Create Teacher, Student and Parent memberships; reuse an existing person and verify no duplicate identity. Edit contact names/email. Deactivate/reactivate a membership and inspect linked records. Attempt duplicate records, invalid dates, inactive references and references from another school; expect localized feedback and preserved form values.
3. Create year, semester, grade, section and subject; assign the new teacher and enroll the student in a valid section. Set the current year. Approve/revoke a parent-child link and verify another school's links remain untouched. Publish a Teacher-audience school announcement.
4. Switch to the new Teacher. Verify assigned class/roster only, applicable announcements and empty states. To grade seeded work, reassign the seeded mathematics class to this teacher. Switching to a teacher without assignments must show empty classes.
5. Create/order a unit and lesson. Add HTTPS links and clearly labeled attachment metadata while the lesson is draft. Inspect the preview, publish, and verify the activity and intended recipient notification records. Invalid URLs and empty fields should fail without clearing the form.
6. Add all three supported question types, including validation failures for duplicate choices, invalid correct answers and non-positive marks. Create a future-dated assessment, link compatible questions, inspect totals/preview, publish and close. Cross-class question links must fail. Historical referenced questions must remain protected.
7. Open a seeded submission, inspect answers/metadata, save partial grading and reload. Complete grading; reject negative/excess marks; verify totals. Release explicitly, verify released result state and scores cannot be overwritten. In the gradebook, distinguish not submitted, ungraded, partially graded, graded-but-unreleased and released rows. Missing marks must remain `—`.
8. Return to School Admin: verify updated counts, activity and shared school identity. Change school, suspend it in Platform Admin, deactivate a membership, reassign/archive a class, and use old direct URLs/native back entries: expect unavailable states without unrelated school records.
9. Switch languages while filtering lists, choosing references, editing school settings or drafting grading. Verify route, school, selections and values remain; inspect RTL/LTR navigation, email/identifier direction, localized dates/numbers, notifications and dialogs. On native, follow the disclosed reload requirement and verify saved UI state is restored.
10. Test desktop, tablet and narrow web widths, internal table scrolling, mobile navigation, keyboard focus, Escape and focus return for dialogs. On Android, check safe areas, keyboard avoidance, searchable native pickers, touch targets, TalkBack labels, hardware back and discard warnings.
11. Export a web JSON snapshot and import its file on Android after confirmation; verify memberships, assignments, drafts, submissions and released scores. Edit on Android, export via share sheet, import on web. Reject malformed JSON, unsupported versions and broken school/question references; confirm existing data remains. Cancel replacement once. No live synchronization should be implied.
12. Reload/restart both apps to verify persistence. Exercise storage failure recovery with an exported backup. Check that Platform Admin reset warns about all shared work and restores the connected fixture only after confirmation.

## Verification limits

Only static source and Git diff review was performed. No automated tests, builds, typechecks, implementation browser automation, APK generation, commits, pushes or deployments were run. Runtime UI, native SDK loading, device navigation/RTL, keyboard/focus behavior, performance and cross-device file transfer remain unverified. No API, database, real file uploads, actual invitations, credential provisioning, authentication or production security enforcement were implemented. Lesson/submission attachments are metadata only; snapshot JSON files are real local files.
