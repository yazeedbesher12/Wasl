# Student and Parent frontend demo

This extends the same Wasl demo used by Platform Admin, School Admin and Teacher. Student and Parent are implemented on Next.js web and real native React Native / Expo. No packages were added. Production authentication, API/database integration and cloud attachments remain deferred.

## Launch and entry

The Git root is `D:\Desktop\Wasl`; the pnpm workspace is the nested `Wasl` directory.

```powershell
cd D:\Desktop\Wasl\Wasl
npx.cmd --yes pnpm@10.28.0 install
npx.cmd --yes pnpm@10.28.0 --filter @wasl/web dev
```

Open http://localhost:3000/demo. Choose school, role and membership. The selector now includes School Admin, Teacher, Student and Parent. It is a fictional demo selector, not a login. Platform Admin remains at `/admin` and staff routes remain available.

In another terminal:

```powershell
cd D:\Desktop\Wasl\Wasl
npx.cmd --yes pnpm@10.28.0 --filter @wasl/mobile start
```

Use compatible Expo Go on Android, or `npx.cmd --yes pnpm@10.28.0 --filter @wasl/mobile android` with an emulator/device configured. These commands come from the unchanged scripts (`next dev -p 3000`, `expo start`, `expo start --android`); they were not run. Existing Node/Expo requirements are in [the frontend guide](frontend-demo.md).

For a fresh demo at Al Nour School / مدرسة النور:

- Student Adam Khalil / آدم خليل: `school-1-student-1@example.com`.
- Teacher Lina Ahmad / لينا أحمد owns the mathematics class.
- Parent Rana Khalil / رنا خليل: `school-1-parent@example.com`, with approved links to Adam at Al Nour and Maya at Al Amal in the fresh fixture.
- Independent fraction practice / تدريب الكسور المستقل is published with all three question types. Its configured window is September 2026 through June 25, 2027. Outside that window it is read-only; there is no late allowance.

Existing v2 data is never seeded again. If an older dataset has only closed/draft assessments or one linked child, use Teacher publication and School Admin linking to prepare the scenario. Do not reset saved work just to obtain fresh examples.

## Student on web and native

Dashboard shows own identity, school, grade/section/current year, derived class/task/submission/released-result counts, upcoming deadlines, published lessons, released results and relevant announcements. Classes derive only from active enrollment and valid teacher assignments. Class details show subject/teacher/section/year, published lessons grouped by unit, public assessments and applicable announcements; no roster or unrelated enrollment is returned.

Lessons are published, active and ordered through active units. HTTPS links open using the browser/native URL handler. File entries are clearly labeled metadata without fake cloud download controls. Unpublished/archived lesson and resource IDs fail scope checks.

Tasks have bilingual search plus subject, status and assignment/exam filters. Upcoming, submitted, historically late, missing and result-available states derive from the same records. Details show instructions, opening/deadline, question count and maximum marks.

Assessment answers support multiple choice, true/false and short answer, question navigation, answered/unanswered summaries, local draft save/resume, confirmed load-saved replacement, inline required-answer validation and confirmed final submission. Errors preserve values. Opening, deadline and explicit teacher closure are rechecked in the service when saving/submitting. Published questions remain readable after closing to preserve a read-only view of entered work, while answer mutations are disabled.

A final submission creates the existing shared `submissions` and `answers` records, activity and teacher/student notifications. Receipts show the stable ID, timestamp, own responses and awaiting-grading / result-not-released / released state. The existing unique student/assessment relationship prevents duplicate final submissions. There is no resubmission operation or invented late allowance.

Results return only explicitly released, complete score records with matching release timestamps, question breakdown and published feedback. Partial grading is indistinguishable from awaiting grading. Ungraded/unreleased work is never treated as zero. Correctness keys are omitted even from released-result models. Profile exposes own identity/enrollment and existing language controls, without credential management.

## Parent on web and native

Children overview returns only active, approved links with active parent/student memberships in each child's active school. Each card labels child, school, grade/section/year and that child's derived counts. The selected child changes every scoped list/count/detail; children across different schools are never merged.

Dashboard, subjects, public lessons, tasks and submission status are read-only. Parent has no answer editor, final-submit action, self-approval or enrollment editor, and service commands reject Parent answer mutations. Released results/feedback match Student and Teacher for that child. Parent receives no draft answers or unreleased scores; receipts expose status only until release.

Announcements must match `all` or `PARENT` and the child's school/class. Student-only and staff-only announcements do not become visible just because they share a school. Notification destinations carry child-link context and recheck access, including revoked links and archived/removed content. Sibling submission notifications are not mislabeled as this child's records. Profile shows parent identity, approved accessible children and language controls.

## Routes and scope

Student routes include `/student/dashboard`, `/student/classes/[id]`, `/student/lessons/[id]`, `/student/tasks/[id]`, `/student/tasks/[id]/attempt`, `/student/submissions/[id]`, `/student/results/[id]`, announcements, notifications and profile.

Parent starts at `/parent/children`. Scoped routes include the approved link ID, e.g. `/parent/child/school-1-link/dashboard` and `/parent/child/school-1-link/tasks/[id]`. A stale/revoked or unauthorized link never silently falls back to another child. Global children/profile pages do not require a selection. School suspension, deactivated membership, removed enrollment/assignment, unpublished/archived content and unknown IDs produce actionable unavailable states.

Native reuses the existing stack, Android hardware back, safe areas, keyboard avoidance and searchable pickers. Parent stack routes carry `childLinkId`; Student answer routes carry an attempt flag. Primary tabs stay limited, with other destinations under More. Busy mutations disable navigation/submission; account/child generation checks suppress stale completion feedback.

`packages/shared/src/demo/learning.ts` is the shared selector/operation boundary. It returns typed explicit view models, without raw values bags, staff grading drafts or correctness fields. Staff selectors remain staff-only. Student identity is derived from membership, never supplied by an answer command. Scope checks exist in operations/selectors, not just menus.

These remain frontend demo checks, not production authorization or exam security. The local fictional dataset and operator role switcher are accessible to the demo operator. Full-dataset JSON transfer stays at demo entry/staff workspaces and is omitted from learner menus because it includes all role records, including private staff data. It is not a learner-facing API.

## Persistence and transfer

Version 3 stays at `wasl.platform-demo.v1` and adds typed `answerDrafts`. v1 retains its school migration; v2 adds an empty draft collection while preserving every existing record/ID. Existing approvals, schools, grades, assignments and content are never reseeded by a v2 upgrade.

The v1 backup requirement remains. A v2 `.backup-v2` copy is attempted when quota permits; the additive v2-to-v3 replacement preserves the complete document even if a second full copy cannot fit. Existing adapters replace atomically; failed writes retain the old persistent document and expose session memory with a warning. Invalid/unsupported data remains untouched.

Draft validation covers IDs, unique student/assessment pairs, role, assessment/school/historical enrollment references, revision/time and question responses. Duplicate final submission pairs are rejected. Final submission removes its draft because immutable answer records now preserve the work.

Save answer draft writes canonical data through the existing browser/native adapter, surviving refresh/restart and snapshot transfer. Optional browser session/native UI caches also retain in-progress text and question position. Existing discard warnings protect unsaved work. Revision checks reject stale saves; loading saved answers requires confirmation. Successful save adopts canonical response ordering to avoid false dirty-state warnings after reload.

The existing confirmed browser JSON download/file/paste import and native JSON share/document-picker transfer now use `wasl-demo-v3.json`. v1/v2 imports remain supported. New drafts, submissions, scores, links and notifications round-trip through the same validated format. Import clears stale membership, child selection and answer UI caches while keeping language. Devices and tabs do not automatically synchronize. No export was run by the agent.

Arabic remains default. Both apps reuse the current dictionaries, Intl dates/numbers and visible عربي / English controls. Language changes preserve child/school, route, filters, question position and entered answers. Web sets document language/direction. Native keeps the existing I18nManager restart notice and persisted UI context; emails and identifiers remain LTR.

There are no shared timetable records/operations. Schedule navigation is omitted and deferred. No new dependencies, design system, font service, backend, database or Prisma changes were introduced.

## Manual acceptance checklist — not executed

Run these checks on both web and Android native:

1. Open existing saved data and old admin/teacher routes. Confirm custom records, IDs, statuses, grading and actions survive v3 migration. Invalid snapshots must not replace current work.
2. As School Admin, create/reuse Student and Parent memberships, enroll the student, assign a teacher and approve the parent link. In another school, reuse the same parent identity, add its Parent membership and approve a link to another enrolled child. Preserve existing links.
3. As Teacher, publish a lesson/resource and future-dated assessment using all three question types. Leave other content draft. Student/Parent must see published content but not drafts, even via direct IDs.
4. As Student, filter tasks, inspect dates/marks, answer questions, save a partial draft, refresh/restart and resume. Switch language midway. Final-submit with missing answers: preserve text, identify the question and keep navigation usable. Load-saved replacement must require confirmation.
5. Complete answers, cancel confirmation once, then submit. Check receipt, exact responses, Teacher's exact submission and notifications. Retry/double-click must not duplicate. Before opening, after deadline or after closure, mutation must fail while cached/saved work remains read-only.
6. Teacher saves partial grading. Student/Parent must show awaiting grading without scores, draft feedback or answer keys in totals/previews/notifications/direct routes. Complete grading without releasing: show result-not-released, still without scores.
7. Explicitly release. Compare every mark, total and published feedback across Teacher, Student and the approved linked Parent. Missing/ungraded work must remain absent from released totals, never zero.
8. Parent switches between children in different schools. Verify all counts, tasks, subjects, announcements, results and notification labels/destinations. Try another parent's link, unrelated submission/result, staff routes and Parent attempt routes: deny access.
9. Revoke a link, deactivate a membership, remove enrollment, reassign/archive a class and suspend a school through existing admin actions. Recheck lists, direct URLs, old notifications and native back entries. Other valid children remain independently accessible.
10. Check read/unread state, profile, Arabic/English labels, dates/numbers, RTL/LTR, LTR identifiers and saved child context. Follow native reload guidance; restore route/filter/form state afterward.
11. Check desktop/tablet/narrow web wrapping, radio labels, keyboard focus, Escape and dialog focus return. On Android check safe areas, short-answer keyboard avoidance, radio accessibility, touch targets, hardware back and busy controls.
12. As demo operator, export web-to-native and native-to-web after confirmations. Compare saved drafts, final answers, parent approvals, notifications, released marks and IDs. Reject unsupported versions, broken draft references and duplicate submissions. Cancel import once. No automatic synchronization should be implied.

## Verification limits

Static source and Git diff review only. No tests, builds, typechecks, browser automation, actual exports, APK generation, commits, pushes or deployments were run. Rendering, keyboard/focus/navigation, native loading/RTL, storage quota/performance and device transfer remain unverified. All data is fictional/local. Real authentication/authorization, backend/database integration, cloud uploads, examination security/proctoring, automatic offline sync and timetable support remain deferred. Attachment entries remain metadata; existing operator snapshots are local JSON files.
