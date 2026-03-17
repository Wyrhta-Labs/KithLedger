import { useParams } from '@tanstack/react-router';
import PersonDetail from '@/components/people/person-detail';

export default function PersonPage() {
  const { id } = useParams({ strict: false });
  return <PersonDetail id={id as string} />;
}
