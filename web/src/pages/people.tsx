import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import PeopleList from '@/components/people/people-list';

export default function PeoplePage() {
  return (
    <div className="space-y-4">
      <PeopleList />
    </div>
  );
}
