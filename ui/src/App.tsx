import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireAuth } from "@/auth/RequireAuth";
import { RequireRole } from "@/auth/RequireRole";
import { AppLayout } from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Devices from "@/pages/Devices";
import MapPage from "@/pages/MapPage";
import SpectrumLab from "@/pages/SpectrumLab";
import RawLab from "@/pages/RawLab";
import Admin from "@/pages/Admin";
import Forbidden from "@/pages/Forbidden";
import NotFound from "@/pages/NotFound";
import SpectrumSources from "@/pages/spectrum/SpectrumSources";
import SpectrumView from "@/pages/spectrum/SpectrumView";
import AdminFilters from "@/pages/admin/AdminFilters";
import FilterEditor from "@/pages/admin/FilterEditor";
import FilterTestMode from "@/pages/admin/FilterTestMode";
import AdminTest from "@/pages/admin/AdminTest";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/forbidden" element={<Forbidden />} />
            
            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            
            {/* Protected routes with layout */}
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              {/* Base routes - all authenticated users */}
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/map" element={<MapPage />} />
              
              {/* Spectrum Analyzer routes - all authenticated users */}
              <Route path="/spectrum/sources" element={<SpectrumSources />} />
              <Route path="/spectrum/view" element={<SpectrumView />} />
              
              {/* Analyst/Admin routes */}
              <Route 
                path="/spectrum-lab" 
                element={
                  <RequireRole roles={['ANALYST', 'ADMIN']}>
                    <SpectrumLab />
                  </RequireRole>
                } 
              />
              <Route 
                path="/raw-lab" 
                element={
                  <RequireRole roles={['ANALYST', 'ADMIN']}>
                    <RawLab />
                  </RequireRole>
                } 
              />
              
              {/* Admin only routes */}
              <Route 
                path="/admin" 
                element={
                  <RequireRole roles={['ADMIN']}>
                    <Admin />
                  </RequireRole>
                } 
              />
              <Route 
                path="/admin/filters" 
                element={
                  <RequireRole roles={['ADMIN']}>
                    <AdminFilters />
                  </RequireRole>
                } 
              />
              <Route 
                path="/admin/filters/:id" 
                element={
                  <RequireRole roles={['ADMIN']}>
                    <FilterEditor />
                  </RequireRole>
                } 
              />
              <Route 
                path="/admin/filters/:id/test" 
                element={
                  <RequireRole roles={['ADMIN']}>
                    <FilterTestMode />
                  </RequireRole>
                } 
              />
              <Route 
                path="/admin/test" 
                element={
                  <RequireRole roles={['ADMIN']}>
                    <AdminTest />
                  </RequireRole>
                } 
              />
            </Route>
            
            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
