import { Shield, KeyRound, UserCircle2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ProfilePage() {
  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCircle2 className="h-5 w-5 text-blue-600" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm text-gray-500">Display name</div>
            <div className="mt-1 text-sm font-medium text-gray-900">Admin</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <Shield className="h-4 w-4 text-blue-600" />
                Access
              </div>
              <p className="mt-2 text-sm text-gray-600">
                This instance uses the single-admin authentication flow configured for your self-hosted setup.
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <KeyRound className="h-4 w-4 text-blue-600" />
                API Access
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Manage long-lived API keys from Settings when you need automation or external integrations.
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Link to="/settings">
              <Button variant="outline">Open Settings</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
