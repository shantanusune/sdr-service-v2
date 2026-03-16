import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldX, ArrowLeft, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Forbidden: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-4">
      <div className="text-center animate-fade-in">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10 mb-6">
          <ShieldX className="h-10 w-10 text-destructive" />
        </div>
        
        <h1 className="text-4xl font-bold text-foreground mb-2">Access Denied</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-md">
          You don't have permission to access this page. Please contact your administrator if you believe this is an error.
        </p>

        <div className="flex gap-4 justify-center">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Back
          </Button>
          <Button onClick={() => navigate('/dashboard')}>
            <Home className="mr-2 h-4 w-4" />
            Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Forbidden;
