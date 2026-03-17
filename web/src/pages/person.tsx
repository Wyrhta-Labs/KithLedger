import { useParams } from '@tanstack/react-router';
import PersonDetail from '@/components/people/person-detail';

export default function PersonPage() {
  const { id } = useParams({ strict: false });
  if (!id) return <div className="text-center py-12 text-gray-500">Invalid person ID.</div>;
  return <PersonDetail id={id} />;
}
