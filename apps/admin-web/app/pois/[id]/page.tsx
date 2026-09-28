import { PoiEditLoader } from '@/components/poi-edit-loader';

export default async function EditPoiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PoiEditLoader id={id} />;
}
