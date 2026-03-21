import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Users, Shield, Settings } from 'lucide-react';

const Admin: React.FC = () => (
  <Tabs defaultValue="users" className="space-y-4">
    <TabsList><TabsTrigger value="users"><Users className="h-4 w-4 mr-2" />Users</TabsTrigger><TabsTrigger value="roles"><Shield className="h-4 w-4 mr-2" />Roles</TabsTrigger><TabsTrigger value="settings"><Settings className="h-4 w-4 mr-2" />Settings</TabsTrigger></TabsList>
    <TabsContent value="users"><Card><CardHeader><CardTitle>Users</CardTitle></CardHeader><CardContent><div className="space-y-2">{['admin@sdr.local', 'analyst@sdr.local', 'viewer@sdr.local'].map(email => <div key={email} className="flex justify-between p-3 rounded-lg border"><span>{email}</span><Badge>Active</Badge></div>)}</div></CardContent></Card></TabsContent>
    <TabsContent value="roles"><Card><CardHeader><CardTitle>Role Assignments</CardTitle></CardHeader><CardContent><div className="space-y-2">{[{ user: 'admin@sdr.local', role: 'ADMIN' }, { user: 'analyst@sdr.local', role: 'ANALYST' }].map(r => <div key={r.user} className="flex justify-between p-3 rounded-lg border"><span>{r.user}</span><Badge variant="outline">{r.role}</Badge></div>)}</div></CardContent></Card></TabsContent>
    <TabsContent value="settings"><Card><CardHeader><CardTitle>System Settings</CardTitle></CardHeader><CardContent><div className="space-y-4"><div className="flex justify-between"><span className="text-muted-foreground">Keycloak URL</span><code className="text-sm">{import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080'}</code></div><div className="flex justify-between"><span className="text-muted-foreground">API URL</span><code className="text-sm">{import.meta.env.VITE_API_BASE_URL || 'http://localhost:8090'}</code></div></div></CardContent></Card></TabsContent>
  </Tabs>
);

export default Admin;
