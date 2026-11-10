import { SchoolForm } from "@/components/admin/school-form";

export default async function EditSchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SchoolForm id={id} />;
}
