'use client';
import { useState } from 'react';
import { useApiSession, home } from '@/components/connected/session';
import { EducationArt } from '@/components/education';
import Link from 'next/link';
export default function Login() {
  const s = useApiSession();
  const ar = s.locale === 'ar';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <main className="demo-entry login-page">
      <div className="entry-composition">
        <aside className="entry-introduction">
          <span className="entry-wordmark">{ar ? 'وصل' : 'Wasl'}</span>
          <h1>{ar ? 'تعلّم، تواصل، وتقدّم' : 'Learn, connect, grow'}</h1>
          <EducationArt theme="entry" />
        </aside>
        <section className="entry-selection">
          <div className="language-switch">
            <button onClick={() => s.setLocale('ar')}>عربي</button>
            <button onClick={() => s.setLocale('en')}>English</button>
          </div>
          <h1>{ar ? 'تسجيل الدخول' : 'Sign in'}</h1>
          <form
            className="panel form-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void s.login(email, password);
            }}
          >
            <label>
              {ar ? 'البريد الإلكتروني' : 'Email'}
              <input
                name="email"
                autoComplete="username"
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              {ar ? 'كلمة المرور' : 'Password'}
              <input
                name="password"
                autoComplete="current-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {s.error === 'revocationUnconfirmed' && (
              <div className="form-alert">
                <p role="alert">
                  {ar ? 'تعذّر تأكيد إنهاء الجلسة على الخادم.' : 'Server sign-out could not be confirmed.'}
                </p>
                <button type="button" disabled={s.busy} onClick={() => void s.logout()}>
                  {ar ? 'إعادة محاولة تسجيل الخروج' : 'Retry sign-out'}
                </button>
              </div>
            )}
            {s.error && s.error !== 'revocationUnconfirmed' && (
              <p role="alert" className="form-alert">
                {s.error === 'invalidCredentials'
                  ? ar
                    ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
                    : 'Incorrect email or password.'
                  : ar
                    ? 'تعذّر الاتصال بالخدمة. حاول مرة أخرى.'
                    : 'Could not reach the service. Please retry.'}
              </p>
            )}
            <button className="button" disabled={s.busy}>
              {ar ? 'دخول' : 'Sign in'}
            </button>
          </form>
          {s.user && (
            <Link className="text-link" href={home(s.user.activeRole)}>
              {ar ? 'العودة لحسابي' : 'Back to my account'}
            </Link>
          )}
        </section>
      </div>
    </main>
  );
}
