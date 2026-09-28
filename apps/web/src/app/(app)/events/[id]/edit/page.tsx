import { redirect } from 'next/navigation';

/** Editing moved into the event's Settings area; old links still land there. */
export default async function EditEventRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/events/${id}/settings`);
}
