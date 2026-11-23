import { redirect } from 'next/navigation';
// Old bookmarks now enter the authenticated workspace; stored snapshots are untouched.
export default function Page() { redirect('/login'); }
