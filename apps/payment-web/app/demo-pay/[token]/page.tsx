import { DemoPayment } from '@/components/demo-payment';

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <DemoPayment token={token} />;
}
