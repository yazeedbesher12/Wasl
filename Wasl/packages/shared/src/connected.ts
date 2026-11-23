import type { Role } from './index';
export type Row = { id: string; [key: string]: unknown };
export type Field = {
  key: string;
  ar: string;
  en: string;
  type?:
    | 'text'
    | 'textarea'
    | 'email'
    | 'password'
    | 'number'
    | 'date'
    | 'datetime-local'
    | 'checkbox';
  options?: string[];
  source?: string;
  optional?: boolean;
  createOnly?: boolean;
};
export type Catalog = {
  key: string;
  path: string;
  ar: string;
  en: string;
  fields: Field[];
  columns: string[];
  create?: Role[];
  edit?: Role[];
};
const f = (key: string, ar: string, en: string, rest: Partial<Field> = {}): Field => ({
  key,
  ar,
  en,
  ...rest,
});
const name = f('name', 'الاسم', 'Name');
const title = f('title', 'العنوان', 'Title');
const classField = f('sectionSubjectId', 'الصف والمادة', 'Class and subject', {
  source: 'assignments',
  createOnly: true,
});
const order = f('order', 'الترتيب', 'Order', { type: 'number' });
export const catalog: Record<string, Catalog> = Object.fromEntries(
  (
    [
      {
        key: 'schools',
        path: 'admin/schools',
        ar: 'المدارس',
        en: 'Schools',
        columns: ['name', 'nameAr', 'active', 'studentCount', 'teacherCount'],
        create: ['PLATFORM_ADMIN'],
        edit: ['PLATFORM_ADMIN'],
        fields: [
          name,
          f('nameAr', 'الاسم بالعربية', 'Arabic name', { optional: true }),
          f('locale', 'اللغة', 'Language', { options: ['ar', 'en'] }),
        ],
      },
      {
        key: 'users',
        path: 'users',
        ar: 'الحسابات',
        en: 'Accounts',
        columns: ['fullName', 'email', 'active'],
        create: ['SCHOOL_ADMIN'],
        fields: [
          f('fullName', 'الاسم الكامل', 'Full name'),
          f('email', 'البريد الإلكتروني', 'Email', { type: 'email' }),
          f(
            'password',
            'كلمة المرور الأولية (12 حرفًا على الأقل)',
            'Initial password (at least 12 characters)',
            { type: 'password' },
          ),
          f('role', 'الدور', 'Role', { options: ['TEACHER', 'STUDENT', 'PARENT', 'SCHOOL_ADMIN'] }),
        ],
      },
      {
        key: 'memberships',
        path: 'memberships',
        ar: 'عضويات المدرسة',
        en: 'School memberships',
        columns: ['userId', 'role', 'active'],
        create: ['SCHOOL_ADMIN'],
        fields: [
          f('email', 'بريد حساب موجود', 'Existing account email', { type: 'email' }),
          f('role', 'الدور', 'Role', { options: ['TEACHER', 'STUDENT', 'PARENT', 'SCHOOL_ADMIN'] }),
        ],
      },
      {
        key: 'years',
        path: 'academic-years',
        ar: 'السنوات الدراسية',
        en: 'Academic years',
        columns: ['name', 'startDate', 'endDate', 'archived'],
        create: ['SCHOOL_ADMIN'],
        edit: ['SCHOOL_ADMIN'],
        fields: [
          name,
          f('startDate', 'تاريخ البداية', 'Start date', { type: 'date' }),
          f('endDate', 'تاريخ النهاية', 'End date', { type: 'date' }),
        ],
      },
      {
        key: 'semesters',
        path: 'semesters',
        ar: 'الفصول الدراسية',
        en: 'Semesters',
        columns: ['name', 'academicYearId', 'startDate', 'endDate'],
        create: ['SCHOOL_ADMIN'],
        edit: ['SCHOOL_ADMIN'],
        fields: [
          name,
          f('academicYearId', 'السنة الدراسية', 'Academic year', {
            source: 'years',
            createOnly: true,
          }),
          f('startDate', 'تاريخ البداية', 'Start date', { type: 'date' }),
          f('endDate', 'تاريخ النهاية', 'End date', { type: 'date' }),
        ],
      },
      {
        key: 'grades',
        path: 'grades',
        ar: 'الصفوف الدراسية',
        en: 'Grades',
        columns: ['name', 'level'],
        create: ['SCHOOL_ADMIN'],
        edit: ['SCHOOL_ADMIN'],
        fields: [name, f('level', 'المستوى', 'Level', { type: 'number' })],
      },
      {
        key: 'sections',
        path: 'sections',
        ar: 'الشُعب',
        en: 'Sections',
        columns: ['name', 'academicYearId', 'gradeId'],
        create: ['SCHOOL_ADMIN'],
        edit: ['SCHOOL_ADMIN'],
        fields: [
          name,
          f('academicYearId', 'السنة الدراسية', 'Academic year', {
            source: 'years',
            createOnly: true,
          }),
          f('gradeId', 'الصف الدراسي', 'Grade', { source: 'grades', createOnly: true }),
        ],
      },
      {
        key: 'subjects',
        path: 'subjects',
        ar: 'المواد',
        en: 'Subjects',
        columns: ['nameAr', 'nameEn', 'code'],
        create: ['SCHOOL_ADMIN'],
        edit: ['SCHOOL_ADMIN'],
        fields: [
          f('nameAr', 'الاسم بالعربية', 'Arabic name'),
          f('nameEn', 'الاسم بالإنجليزية', 'English name'),
          f('code', 'رمز المادة', 'Subject code', { optional: true }),
        ],
      },
      {
        key: 'assignments',
        path: 'section-subjects',
        ar: 'توزيع المواد والمعلمين',
        en: 'Teaching assignments',
        columns: ['sectionId', 'subjectId', 'teacherId'],
        create: ['SCHOOL_ADMIN'],
        edit: ['SCHOOL_ADMIN'],
        fields: [
          f('sectionId', 'الشعبة', 'Section', { source: 'sections', createOnly: true }),
          f('subjectId', 'المادة', 'Subject', { source: 'subjects', createOnly: true }),
          f('teacherId', 'المعلم', 'Teacher', { source: 'teachers', optional: true }),
        ],
      },
      {
        key: 'enrollments',
        path: 'enrollments',
        ar: 'تسجيل الطلاب',
        en: 'Student enrollments',
        columns: ['studentId', 'sectionId', 'status'],
        create: ['SCHOOL_ADMIN'],
        edit: ['SCHOOL_ADMIN'],
        fields: [
          f('studentId', 'الطالب', 'Student', { source: 'students', createOnly: true }),
          f('sectionId', 'الشعبة', 'Section', { source: 'sections', createOnly: true }),
          f('status', 'الحالة', 'Status', {
            options: ['ACTIVE', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN'],
          }),
        ],
      },
      {
        key: 'links',
        path: 'parent-links',
        ar: 'روابط أولياء الأمور',
        en: 'Parent links',
        columns: ['parentId', 'studentId', 'status'],
        create: ['SCHOOL_ADMIN'],
        fields: [
          f('parentId', 'ولي الأمر', 'Parent', { source: 'parents' }),
          f('studentId', 'الطالب', 'Student', { source: 'students' }),
        ],
      },
      {
        key: 'units',
        path: 'units',
        ar: 'الوحدات',
        en: 'Units',
        columns: ['title', 'sectionSubjectId', 'order'],
        create: ['TEACHER'],
        edit: ['TEACHER'],
        fields: [title, classField, order],
      },
      {
        key: 'lessons',
        path: 'lessons',
        ar: 'الدروس',
        en: 'Lessons',
        columns: ['title', 'unitId', 'status'],
        create: ['TEACHER'],
        edit: ['TEACHER'],
        fields: [
          title,
          f('unitId', 'الوحدة', 'Unit', { source: 'units', createOnly: true }),
          f('body', 'المحتوى', 'Content', { type: 'textarea', optional: true }),
          order,
        ],
      },
      {
        key: 'resources',
        path: 'resources',
        ar: 'المصادر والملفات',
        en: 'Resources and files',
        columns: ['title', 'lessonId', 'type'],
        create: ['TEACHER'],
        edit: ['TEACHER'],
        fields: [
          title,
          f('lessonId', 'الدرس', 'Lesson', { source: 'lessons' }),
          f('type', 'النوع', 'Type', { options: ['LINK', 'VIDEO', 'FILE'] }),
          f('url', 'الرابط (HTTPS)', 'Link (HTTPS)', { optional: true }),
          f('offlineAllowed', 'السماح بالتنزيل', 'Allow download', { type: 'checkbox' }),
        ],
      },
      {
        key: 'banks',
        path: 'question-banks',
        ar: 'بنوك الأسئلة',
        en: 'Question banks',
        columns: ['name', 'subjectId'],
        create: ['TEACHER'],
        edit: ['TEACHER'],
        fields: [
          name,
          f('subjectId', 'المادة', 'Subject', { source: 'subjects', createOnly: true }),
        ],
      },
      {
        key: 'questions',
        path: 'questions',
        ar: 'الأسئلة',
        en: 'Questions',
        columns: ['text', 'type', 'points'],
        create: ['TEACHER'],
        edit: ['TEACHER'],
        fields: [
          f('questionBankId', 'بنك الأسئلة', 'Question bank', {
            source: 'banks',
            createOnly: true,
          }),
          f('text', 'نص السؤال', 'Question text', { type: 'textarea' }),
          f('type', 'النوع', 'Type', {
            options: ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY', 'FILE_UPLOAD'],
          }),
          f('points', 'العلامة القصوى', 'Maximum points', { type: 'number' }),
        ],
      },
      {
        key: 'assessments',
        path: 'assessments',
        ar: 'الواجبات والامتحانات',
        en: 'Assignments and exams',
        columns: ['title', 'type', 'status', 'dueAt'],
        create: ['TEACHER'],
        edit: ['TEACHER'],
        fields: [
          title,
          classField,
          f('type', 'النوع', 'Type', { options: ['ASSIGNMENT', 'EXAM'] }),
          f('instructions', 'التعليمات', 'Instructions', { type: 'textarea', optional: true }),
          f('opensAt', 'موعد الفتح', 'Opens at', { type: 'datetime-local', optional: true }),
          f('dueAt', 'آخر موعد للتسليم', 'Deadline', { type: 'datetime-local', optional: true }),
        ],
      },
      {
        key: 'announcements',
        path: 'announcements',
        ar: 'الإعلانات',
        en: 'Announcements',
        columns: ['title', 'status', 'publishedAt'],
        create: ['SCHOOL_ADMIN', 'TEACHER'],
        edit: ['SCHOOL_ADMIN', 'TEACHER'],
        fields: [
          title,
          f('body', 'المحتوى', 'Content', { type: 'textarea' }),
          { ...classField, optional: true },
        ],
      },
      {
        key: 'notifications',
        path: 'notifications',
        ar: 'الإشعارات',
        en: 'Notifications',
        columns: ['title', 'type', 'createdAt', 'readAt'],
        fields: [],
      },
    ] satisfies Catalog[]
  ).map((c) => [c.key, c]),
);
export const roleNav: Record<Role, string[]> = {
  PLATFORM_ADMIN: ['dashboard', 'schools', 'profile'],
  SCHOOL_ADMIN: [
    'dashboard',
    'users',
    'memberships',
    'academics',
    'links',
    'announcements',
    'notifications',
    'profile',
  ],
  TEACHER: [
    'dashboard',
    'classes',
    'units',
    'lessons',
    'resources',
    'banks',
    'questions',
    'assessments',
    'submissions',
    'gradebook',
    'announcements',
    'notifications',
    'profile',
  ],
  STUDENT: [
    'dashboard',
    'classes',
    'lessons',
    'resources',
    'tasks',
    'submissions',
    'results',
    'announcements',
    'notifications',
    'profile',
  ],
  PARENT: [
    'children',
    'classes',
    'lessons',
    'resources',
    'tasks',
    'results',
    'announcements',
    'notifications',
    'profile',
  ],
};
export const academics = [
  'years',
  'semesters',
  'grades',
  'sections',
  'subjects',
  'assignments',
  'enrollments',
];
const extra: Record<string, [string, string]> = {
  more: ['المزيد', 'More'],
  ANNOUNCEMENT_PUBLISHED: ['إعلان جديد', 'New announcement'],
  ASSESSMENT_PUBLISHED: ['تقييم جديد', 'New assessment'],
  SUBMISSION_RECEIVED: ['تم استلام تسليم', 'Submission received'],
  score: ['العلامة', 'Score'],
  totalPoints: ['العلامة القصوى', 'Maximum points'],
  submittedAt: ['وقت التسليم', 'Submitted at'],
  teacher: ['المعلم', 'Teacher'],
  status: ['الحالة', 'Status'],
  publishedAt: ['وقت النشر', 'Published at'],
  dashboard: ['الرئيسية', 'Dashboard'],
  profile: ['حسابي', 'My profile'],
  academics: ['البنية الأكاديمية', 'Academics'],
  children: ['أبنائي', 'My children'],
  classes: ['صفوفي', 'My classes'],
  tasks: ['المهام', 'Tasks'],
  submissions: ['التسليمات', 'Submissions'],
  gradebook: ['دفتر العلامات', 'Gradebook'],
  results: ['النتائج', 'Results'],
  DRAFT: ['مسودة', 'Draft'],
  PUBLISHED: ['منشور', 'Published'],
  ARCHIVED: ['مؤرشف', 'Archived'],
  SCHEDULED: ['مجدول', 'Scheduled'],
  OPEN: ['مفتوح', 'Open'],
  CLOSED: ['مغلق', 'Closed'],
  GRADING: ['قيد التصحيح', 'Grading'],
  RESULTS_RELEASED: ['النتائج منشورة', 'Results released'],
  IN_PROGRESS: ['مسودة إجابات', 'Answer draft'],
  SUBMITTED: ['تم التسليم', 'Submitted'],
  GRADED: ['تم التصحيح', 'Graded'],
  ACTIVE: ['نشط', 'Active'],
  WITHDRAWN: ['منسحب', 'Withdrawn'],
  TRANSFERRED: ['منتقل', 'Transferred'],
  GRADUATED: ['متخرج', 'Graduated'],
  PENDING: ['بانتظار التحقق', 'Pending'],
  VERIFIED: ['موثّق', 'Verified'],
  REJECTED: ['مرفوض', 'Rejected'],
  SCHOOL_ADMIN: ['مدير المدرسة', 'School admin'],
  PLATFORM_ADMIN: ['مدير المنصة', 'Platform admin'],
  TEACHER: ['معلم', 'Teacher'],
  STUDENT: ['طالب', 'Student'],
  PARENT: ['ولي أمر', 'Parent'],
  ASSIGNMENT: ['واجب', 'Assignment'],
  EXAM: ['امتحان', 'Exam'],
  FILE: ['ملف', 'File'],
  LINK: ['رابط', 'Link'],
  VIDEO: ['فيديو', 'Video'],
  MULTIPLE_CHOICE: ['اختيار من متعدد', 'Multiple choice'],
  TRUE_FALSE: ['صح أو خطأ', 'True or false'],
  SHORT_ANSWER: ['إجابة قصيرة', 'Short answer'],
  ESSAY: ['سؤال مقالي', 'Essay'],
  FILE_UPLOAD: ['تسليم ملف', 'File upload'],
};
export const word = (key: string, ar: boolean): string =>
  catalog[key]?.[ar ? 'ar' : 'en'] ??
  extra[key]?.[ar ? 0 : 1] ??
  Object.values(catalog)
    .flatMap((c) => c.fields)
    .find((f) => f.key === key)?.[ar ? 'ar' : 'en'] ??
  (
    {
      active: ar ? 'مفعّل' : 'Active',
      archived: ar ? 'مؤرشف' : 'Archived',
      studentCount: ar ? 'الطلاب' : 'Students',
      teacherCount: ar ? 'المعلمون' : 'Teachers',
      createdAt: ar ? 'التاريخ' : 'Created',
      readAt: ar ? 'قُرئ في' : 'Read at',
      userId: ar ? 'الحساب' : 'Account',
      parentId: ar ? 'ولي الأمر' : 'Parent',
      studentId: ar ? 'الطالب' : 'Student',
    } as Record<string, string>
  )[key] ??
  key;
export const rowName = (row: Row, ar: boolean): string =>
  String(
    row[ar ? 'nameAr' : 'nameEn'] ||
      row.fullName ||
      row.title ||
      row.name ||
      row.text ||
      row.email ||
      row.id,
  );
