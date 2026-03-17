import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Edit2, Trash2, Mail, Phone, Calendar, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { usePerson, useUpdatePerson, useDeletePerson } from '@/hooks/use-people';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatBirthday } from '@/lib/format';
import PersonForm, { type PersonFormValues } from './person-form';
import type { UpdatePersonInput } from '@/api/people';
import InteractionList from '@/components/interactions/interaction-list';
import ReminderList from '@/components/reminders/reminder-list';
import RelationshipList from '@/components/relationships/relationship-list';
import MiniGraph from '@/components/graph/graph-view';

interface PersonDetailProps {
  id: string;
}

export default function PersonDetail({ id }: PersonDetailProps) {
  const [tab, setTab] = useState('interactions');
  const [showEdit, setShowEdit] = useState(false);
  const { data, isLoading } = usePerson(id);
  const updateMutation = useUpdatePerson(id);
  const deleteMutation = useDeletePerson();
  const { toast } = useToast();
  const navigate = useNavigate();

  if (isLoading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!data?.data) return <div className="text-center py-12 text-gray-500">Person not found.</div>;

  const person = data.data;

  function getInitials(name: string) {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }

  const handleUpdate = async (values: PersonFormValues) => {
    await updateMutation.mutateAsync(values as UpdatePersonInput);
    toast('Person updated', 'success');
    setShowEdit(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${person.name}? This will remove all their data.`)) return;
    await deleteMutation.mutateAsync(id);
    toast('Person deleted', 'success');
    navigate({ to: '/people' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/people' })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold text-gray-900 flex-1">{person.name}</h2>
        <Button variant="outline" size="sm" onClick={() => setShowEdit(true)}>
          <Edit2 className="h-4 w-4" /> Edit
        </Button>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-start gap-6">
        <Avatar className="h-16 w-16">
          {person.avatarUrl ? (
            <img src={person.avatarUrl} alt={person.name} className="h-full w-full object-cover rounded-full" />
          ) : (
            <AvatarFallback className="text-xl">{getInitials(person.name)}</AvatarFallback>
          )}
        </Avatar>
        <div className="flex-1 space-y-2">
          <h3 className="text-lg font-semibold text-gray-900">{person.name}</h3>
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            {person.email && (
              <span className="flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />{person.email}
              </span>
            )}
            {person.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />{person.phone}
              </span>
            )}
            {person.birthday && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />{formatBirthday(person.birthday)} ({formatDate(person.birthday)})
              </span>
            )}
          </div>
          {person.tags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Tag className="h-3.5 w-3.5 text-gray-400" />
              {person.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}
          {person.notes && <p className="text-sm text-gray-600 mt-2">{person.notes}</p>}
        </div>
        <div className="text-xs text-gray-400">
          Added {formatDate(person.createdAt)}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="interactions">Interactions</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
        </TabsList>
        <TabsContent value="interactions">
          <InteractionList personId={id} />
        </TabsContent>
        <TabsContent value="reminders">
          <ReminderList personId={id} />
        </TabsContent>
        <TabsContent value="relationships">
          <RelationshipList personId={id} />
        </TabsContent>
        <TabsContent value="graph">
          <MiniGraph personId={id} />
        </TabsContent>
      </Tabs>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {person.name}</DialogTitle>
            <DialogClose onClose={() => setShowEdit(false)} />
          </DialogHeader>
          <PersonForm
            person={person}
            onSubmit={handleUpdate}
            onCancel={() => setShowEdit(false)}
            isLoading={updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
