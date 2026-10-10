import { FieldPoi } from '@/components/field-poi';

export default async function FieldPoiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FieldPoi id={id} />;
}
