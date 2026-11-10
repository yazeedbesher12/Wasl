import { SchoolDetail } from "@/components/admin/school-detail";

export default async function SchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SchoolDetail id={id} />;
}
