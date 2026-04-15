import { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useCreateSettingValue, useDeleteSettingValue, useUpdateSettingValue } from '@/hooks/use-setting-values';
import { SETTING_CATEGORY_LABELS } from '@/lib/setting-values';
import type { SettingValue } from '@/lib/types';

interface SettingValuesCardProps {
  category: SettingValue['category'];
  values: SettingValue[];
}

export default function SettingValuesCard({ category, values }: SettingValuesCardProps) {
  const { toast } = useToast();
  const createMutation = useCreateSettingValue();
  const updateMutation = useUpdateSettingValue();
  const deleteMutation = useDeleteSettingValue();

  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { value: string; label: string }>>({});

  const sortedValues = useMemo(
    () => [...values].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [values]
  );

  const getDraft = (value: SettingValue) => drafts[value.id] ?? { value: value.value, label: value.label };

  const handleDraftChange = (id: string, next: Partial<{ value: string; label: string }>) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...next,
      },
    }));
  };

  const handleCreate = async () => {
    if (!newValue.trim() || !newLabel.trim()) return;
    try {
      await createMutation.mutateAsync({
        category,
        value: newValue.trim(),
        label: newLabel.trim(),
        sortOrder: sortedValues.length,
      });

      setNewValue('');
      setNewLabel('');
      toast(`${SETTING_CATEGORY_LABELS[category]} updated`, 'success');
    } catch (error) {
      toast((error as Error).message ?? 'Failed to create value', 'error');
    }
  };

  const handleSave = async (value: SettingValue) => {
    const draft = getDraft(value);
    try {
      await updateMutation.mutateAsync({
        id: value.id,
        input: {
          value: draft.value.trim(),
          label: draft.label.trim(),
        },
      });

      setDrafts((current) => {
        const next = { ...current };
        delete next[value.id];
        return next;
      });
      toast('Value saved', 'success');
    } catch (error) {
      toast((error as Error).message ?? 'Failed to save value', 'error');
    }
  };

  const handleToggleActive = async (value: SettingValue) => {
    try {
      await updateMutation.mutateAsync({
        id: value.id,
        input: { isActive: !value.isActive },
      });
      toast(value.isActive ? 'Value hidden from forms' : 'Value re-enabled', 'success');
    } catch (error) {
      toast((error as Error).message ?? 'Failed to update value', 'error');
    }
  };

  const handleDelete = async (value: SettingValue) => {
    if (!confirm(`Delete "${value.label}"?`)) return;
    try {
      await deleteMutation.mutateAsync(value.id);
      toast('Value deleted', 'success');
    } catch (error) {
      toast((error as Error).message ?? 'Failed to delete value', 'error');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">{SETTING_CATEGORY_LABELS[category]}</CardTitle>
          <Badge variant="secondary">{sortedValues.length} values</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Stored value, e.g. coffee-chat"
            />
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Display label, e.g. Coffee chat"
            />
            <Button
              onClick={handleCreate}
              disabled={!newValue.trim() || !newLabel.trim() || createMutation.isPending}
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {sortedValues.map((value) => {
            const draft = getDraft(value);
            const isDirty = draft.value !== value.value || draft.label !== value.label;

            return (
              <div key={value.id} className="rounded-xl border border-gray-200 p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Input
                    value={draft.value}
                    onChange={(e) => handleDraftChange(value.id, { value: e.target.value })}
                    placeholder="Stored value"
                  />
                  <Input
                    value={draft.label}
                    onChange={(e) => handleDraftChange(value.id, { label: e.target.value })}
                    placeholder="Display label"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleActive(value)}
                      disabled={updateMutation.isPending}
                    >
                      {value.isActive ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSave(value)}
                      disabled={!draft.value.trim() || !draft.label.trim() || !isDirty || updateMutation.isPending}
                    >
                      <Save className="h-4 w-4" /> Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => handleDelete(value)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <Badge variant={value.isActive ? 'secondary' : 'outline'}>
                    {value.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  <span>{value.usageCount} in use</span>
                </div>
              </div>
            );
          })}

          {sortedValues.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
              No values configured yet.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
