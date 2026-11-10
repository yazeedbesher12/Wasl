# Wasl educational visual system

This change restyles the existing connected frontend. It adds no database, API,
authentication, records, roles, or dependencies. Existing local demo authentication
and role visibility remain simulated.

## Screen and control inventory

| Area | Presentation updated | Existing interactions retained |
| --- | --- | --- |
| Web demo entry | Illustrated introduction beside the account panel | School/role selection, account search and filtering, open workspace, language, Platform Admin link, snapshot tools |
| Platform Admin web | Navy sidebar, connected-school welcome, metric badges, tables, activity, profile/forms, empty states | Schools search/status/sort/pagination, add/edit/details, suspend/reactivate confirmation, activity filters, settings and confirmed reset |
| School Admin web/native | School welcome, metric/action tiles, navy navigation, shared surfaces | Memberships, academic tabs, teacher assignments, enrollments, approved parent links, announcements, notifications, settings, transfer |
| Teacher web/native | Board/book welcome, actual assigned subject strip and illustrated class cards | Content editors, units, lessons, resources, banks/questions, assessments, submissions, grading/release, gradebook, search/filter/pagination, transfer |
| Student web/native | Learning welcome, enrolled subject badges, illustrated class/empty states | Published lessons/resources, task filters/details, answer drafts, attempt/confirmation/receipt, released results, notifications/profile |
| Parent web/native | Support-themed family welcome, child context, subject cards | Approved child links, explicit child/school selection, published schoolwork and released results, read-only scope, notifications/profile |
| Native shell | Navy header and bottom tabs, grouped More navigation, restrained edge artwork | Safe areas, keyboard avoidance, back/dirty-form confirmation, account/language switching, existing navigation stack |

Dense tables, grading, assessment answers, and long reading remain on quiet surfaces.
No artwork introduces achievements, progress percentages, subjects, or statistics.
Subject destinations use the original class IDs and existing class routes. Unknown
subject names receive the neutral book illustration.

## Components and assets

- `packages/shared/src/demo/visual.ts`: presentation palette/radii, motion durations,
  original vector coordinates, subject classification and navigation icon/group maps.
- `apps/web/src/components/education.tsx`: SVG renderer, welcome, subject destinations,
  navigation marks and decorative background. No remote artwork requests.
- `apps/web/src/app/education.css`: responsive navy/blue system, warm surfaces,
  subject circles, table/form styling, type hierarchy, shadows and motion.
- `apps/web/public/fonts`: locally bundled variable Noto Sans Arabic and SIL Open
  Font License. Arabic uses this font; Latin uses the system Segoe UI/Arial stack.
- `apps/mobile/src/education.tsx`: the same vectors rendered as real native views,
  original native navigation marks, welcomes, subject scrolling, quick-action tiles,
  grouped navigation, background, motion provider and initial reveal. Native text
  uses platform fonts with the same hierarchy and bilingual direction rules.

The seven subject themes are mathematics, chemistry, biology, physics, languages,
computing, and a book fallback. Role illustrations use school connections, books,
globe/pencil/notebook, teaching board/cards, and a supportive check motif.

The public [Wasleh reference](https://wasleh.net/ar) was accessible read-only. No
reference logo, mascot, screenshots, marketplace features, or assets were copied.
The attachment directory contained the written brief only; the circular subject
composition follows its screenshot description.

## Motion and accessibility

Web: 380ms welcome/entry reveal, 180–200ms feedback, small hover lifts, 17–24s
selected ambient cycles. CSS reduced-motion disables animation/transitions, and
page visibility pauses ambient motion. Decorations are hidden from assistive
technology and cannot receive pointer input. Subject links are keyboard focusable;
dark navigation has a light focus outline. Existing dialog focus/Escape/restore,
labels, feedback and dirty-navigation handling remain.

Native: accessibility reduced-motion and AppState are observed once. Ambient
native-driver loops stop when inactive or reduced motion is requested. Initial
reveals do not depend on form/filter/data values, and introduce no navigation keys.
Press feedback uses transforms. Native selection modals use no slide animation
under reduced motion. Artwork scales within its own measured bounds, is excluded
from accessibility, and uses logical coordinates inside an LTR illustration canvas.

## Launch for manual review

From PowerShell, `D:\Desktop\Wasl\Wasl` is the workspace. `packageManager` pins
pnpm 10.28.0. Since the plain `pnpm` command was unavailable, use the installed
Corepack command directly:

```powershell
cd D:\Desktop\Wasl\Wasl
corepack.cmd pnpm install
corepack.cmd pnpm --filter @wasl/web dev
```

Open `http://localhost:3000/demo`; Platform Admin remains at `/admin`.
For the existing native app, run `corepack.cmd pnpm --filter @wasl/mobile start`
and use the repository's Expo development setup.

These are manifest-derived instructions, not commands executed for verification.

## Manual review checklist (not executed)

- Review all five web roles and all four native roles in Arabic and English.
  Check sidebar mirroring, grouping, active routes, fonts, numbers, dates, long
  names, large system text, email/URL direction, and the mobile drawer.
- Use keyboard focus throughout entry, subject links, forms and dialogs. Check
  Escape/focus restoration, screen-reader labels, native back/keyboard behavior,
  and touch targets. Check 320px, tablet and desktop widths without page overflow.
- Follow subject badges and class cards; verify the actual assignment/enrollment,
  subject and section metadata. Check a school-defined unknown subject fallback.
- Change language with search/filter values and an unsaved form or answer draft.
  Confirm nothing is remounted or cleared, and entry animation does not replay.
- Check school add/edit/suspend/reactivate, membership/assignment/enrollment/parent
  links, content publishing, submission, grading and result release. Verify parent
  child context and unreleased-grade privacy remain intact across direct routes.
- Reload/reopen to check saved data, navigation, locale and drafts. Review existing
  snapshot tools and reset confirmation using disposable demo data; reset remains
  an explicit operator action, never part of loading the new design.
- Enable reduced motion, switch tabs/apps, and resume. Check ambient motion stops,
  static artwork remains usable, no focus is obscured, and scrolling stays smooth.

## Static review and limits

Shared `model.ts`, `domain.ts`, `learning.ts`, `storage.ts`, `fixtures.ts`,
`legacy.ts`, `schema.ts`, and `presentation.ts` had identical source fingerprints
before and after this redesign. Existing providers, storage adapters, attempt
workflows, route files, snapshots, IDs and backend contracts were not rewritten.
Review covered new JSX/native composition, route targets, translated copy,
hydration boundaries, motion cleanup, and preservation of existing handlers.
The local root `AGENTS.md` remains ignored and unstaged.

No tests, builds, typechecks, implementation browser automation, APK generation,
actual snapshot exports, commits, pushes or deployments were performed. Runtime
behavior and rendered visual quality still require the manual review above.
