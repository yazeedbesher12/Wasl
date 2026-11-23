import type { Page } from '@wasl/shared';
export async function api<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
  const result = await fetch('/api/wasl/' + path, {
    method,
    cache: 'no-store',
    headers: input === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const body = result.status === 204 ? undefined : await result.json();
  if (!result.ok)
    throw Object.assign(new Error(body?.message ?? 'Request failed'), {
      status: result.status,
      body,
    });
  return body as T;
}
export async function all<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  while (true) {
    const r = await api<Page<T>>(
      path + (path.includes('?') ? '&' : '?') + `limit=100&page=${page}`,
    );
    rows.push(...r.items);
    if (!r.items.length || rows.length >= r.total) return rows;
    page++;
  }
}
export function errorText(error: unknown, ar: boolean) {
  const status = (error as { status?: number })?.status;
  const messages: Record<number, [string, string]> = {
    400: [
      'تحقق من الحقول المطلوبة والبيانات المدخلة.',
      'Check the required fields and entered values.',
    ],
    401: ['انتهت جلسة الدخول. سجّل الدخول مرة أخرى.', 'Your session ended. Please sign in again.'],
    403: ['حسابك لا يملك صلاحية تنفيذ هذه العملية.', 'Your account cannot perform this action.'],
    404: [
      'هذا السجل غير متاح لحسابك، أو لم يعد موجودًا.',
      'This record is unavailable to your account or no longer exists.',
    ],
    409: [
      'لا يمكن تنفيذ العملية في الحالة الحالية. حدّث الصفحة وتحقق من حالة السجل.',
      'This action is not available in the current state. Refresh and check the record status.',
    ],
    413: ['الملف أكبر من الحد المسموح (10 MB).', 'The file exceeds the 10 MB limit.'],
  };
  return (
    messages[status ?? 0]?.[ar ? 0 : 1] ??
    (ar ? 'تعذّر الاتصال بالخدمة. حاول مرة أخرى.' : 'Could not reach the service. Please retry.')
  );
}
