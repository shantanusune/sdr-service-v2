import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Radio, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Login: React.FC = () => {
  const { isAuthenticated, login, isLoading } = useAuth();
  const navigate = useNavigate();
  const USE_MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === 'true';

  // Direct login when mock auth is enabled
  useEffect(() => {
    if (USE_MOCK_AUTH && !isLoading && !isAuthenticated) {
      login();
    }
  }, [USE_MOCK_AUTH, isLoading, isAuthenticated, login]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-4">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      </div>

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md">
        <div className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-8 shadow-2xl animate-fade-in">
          {/* Logo & Title */}
          <div className="flex flex-col items-center mb-8">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4 glow-primary">
              <Radio className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">SDR Command Center</h1>
            <p className="text-muted-foreground mt-2 text-center">
              Secure access to spectrum monitoring and analysis
            </p>
          </div>

          {/* Animated waves */}
          <div className="flex justify-center gap-1 mb-8">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-primary rounded-full animate-pulse"
                style={{
                  height: `${20 + Math.sin(i * 0.8) * 15}px`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>

          {/* Login button */}
          <Button 
            onClick={login}
            className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity"
          >
            Sign in with Keycloak
          </Button>

          {/* Info text */}
          <p className="text-center text-xs text-muted-foreground mt-6">
            Authentication powered by Keycloak OIDC
          </p>
        </div>

        {/* Version info */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          v1.0.0 • © 2024 SDR Command Center
        </p>
      </div>
    </div>
  );
};

export default Login;
