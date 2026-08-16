/**
 * 会话上下文：TanStack Query 驱动（能不造轮子就不造——缓存/失效/重试全交给 Query）。
 * login/register/logout 走 mutation；成功后 invalidateQueries(["me"]) 自动刷新。
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";

import { unwrap, type ApiClient } from "../lib/api";

export interface Me {
  user: { id: string; username: string; role: string; displayName: string };
  student: { id: string; classId: string; studentNo: string; anonNo: string } | null;
}

export interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  login: UseMutationResult<unknown, Error, { username: string; password: string }>;
  register: UseMutationResult<
    unknown,
    Error,
    {
      username: string;
      password: string;
      displayName: string;
      role: "student" | "teacher";
      teacherInviteCode?: string;
      studentNo?: string;
    }
  >;
  logout: UseMutationResult<unknown, Error, void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const qc = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await api.auth.me.get();
      if (res.error) return null;
      return res.data as Me;
    },
    staleTime: 60_000,
  });

  const after = async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  const login = useMutation({
    mutationFn: async (body: { username: string; password: string }) => {
      return unwrap(await api.auth.login.post(body));
    },
    onSuccess: after,
  });

  const register = useMutation({
    mutationFn: async (body: {
      username: string;
      password: string;
      displayName: string;
      role: "student" | "teacher";
      teacherInviteCode?: string;
      studentNo?: string;
    }) => {
      return unwrap(await api.auth.register.post(body));
    },
    onSuccess: after,
  });

  const logout = useMutation({
    mutationFn: async () => {
      return unwrap(await api.auth.logout.post({}));
    },
    onSuccess: after,
  });

  return (
    <AuthContext.Provider
      value={{ me: meQuery.data ?? null, loading: meQuery.isLoading, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
