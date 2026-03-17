import { useState } from 'react';
import { Select } from '@/components/ui/select';
import { REMINDER_STATUSES } from '@/lib/constants';
import ReminderList from '@/components/reminders/reminder-list';

export default function RemindersPage() {
  const [statusFilter, setStatusFilter] = useState('pending');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-40"
        >
          <option value="">All statuses</option>
          {REMINDER_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </div>
      <ReminderList statusFilter={statusFilter || undefined} />
    </div>
  );
}
