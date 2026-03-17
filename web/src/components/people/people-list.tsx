import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Search, Plus, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { usePeople, useCreatePerson, useUpdatePerson, useDeletePerson } from '@/hooks/use-people';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatBirthday } from '@/lib/format';
import PersonForm, { type PersonFormValues } from './person-form';
import type { Person } from '@/lib/types';
import type { CreatePersonInput, UpdatePersonInput } from '@/api/people';

export default function PeopleList() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const limit = 20;
  const { data, isLoading } = usePeople({ q: search || undefined, limit, offset: page * limit });
  const createMutation = useCreatePerson();
  const updateMutation = useUpdatePerson(editPerson?.id ?? '');
  const deleteMutation = useDeletePerson();

  const total = data?.meta?.total ?? 0;
  const people = data?.data ?? [];

  const handleCreate = async (values: PersonFormValues) => {
    await createMutation.mutateAsync(values as CreatePersonInput);
    toast('Person created', 'success');
    setShowCreate(false);
  };

  const handleUpdate = async (values: PersonFormValues) => {
    await updateMutation.mutateAsync(values as UpdatePersonInput);
    toast('Person updated', 'success');
    setEditPerson(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    await deleteMutation.mutateAsync(id);
    toast('Person deleted', 'success');
  };

  function getInitials(name: string) {
    return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Search people..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          Add Person
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : people.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {search ? 'No people found matching your search.' : 'No people yet. Add your first person!'}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Birthday</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow
                    key={person.id}
                    className="cursor-pointer"
                    onClick={() => navigate({ to: '/people/$id', params: { id: person.id } })}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {person.avatarUrl ? (
                            <img src={person.avatarUrl} alt={person.name} className="h-full w-full object-cover rounded-full" />
                          ) : (
                            <AvatarFallback className="text-xs">{getInitials(person.name)}</AvatarFallback>
                          )}
                        </Avatar>
                        <span className="font-medium text-gray-900">{person.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-500">{person.email ?? '—'}</TableCell>
                    <TableCell className="text-gray-500">{formatBirthday(person.birthday)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {person.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                        {person.tags.length > 3 && (
                          <Badge variant="outline" className="text-xs">+{person.tags.length - 3}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-500 text-xs">{formatDate(person.createdAt)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditPerson(person)}
                          title="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-700"
                          onClick={() => handleDelete(person.id, person.name)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {total > limit && (
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Person</DialogTitle>
            <DialogClose onClose={() => setShowCreate(false)} />
          </DialogHeader>
          <PersonForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPerson} onOpenChange={(open) => !open && setEditPerson(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Person</DialogTitle>
            <DialogClose onClose={() => setEditPerson(null)} />
          </DialogHeader>
          {editPerson && (
            <PersonForm
              person={editPerson}
              onSubmit={handleUpdate}
              onCancel={() => setEditPerson(null)}
              isLoading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
