import React, { createContext, useContext, useState, useCallback } from 'react';
import { login as apiLogin } from '../api/auth';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const token = localStorage.getItem('kith_jwt');
    return { token, isAuthenticated: !!token };
  });

  const login = useCallback(async (password: string) => {
    const res = await apiLogin(password);
    const token = res.data.token;
    localStorage.setItem('kith_jwt', token);
    setState({ token, isAuthenticated: true });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('kith_jwt');
    setState({ token: null, isAuthenticated: false });
    window.location.href = '/login';
  }, []);

  return React.createElement(
    AuthContext.Provider,
    { value: { ...state, login, logout } },
    children,
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
