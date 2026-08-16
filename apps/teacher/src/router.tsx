import { Shell, useAuth } from "@sigma/ui";
/** 教师端路由：登录守卫 + 看板/高危名单 */
import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";

import { DashboardPage } from "./pages/dashboard";
import { LoginPage } from "./pages/login";
import { RegisterPage } from "./pages/register";
import { StudentsPage } from "./pages/students";

const NAV = [
  { to: "/dashboard", ni: "F6", label: "班级学情看板" },
  { to: "/students", ni: "F7", label: "高危名单" },
];

function Guard({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="page-body note">加载中…</div>;
  if (!me) return <Navigate to="/login" replace />;
  if (me.user.role !== "teacher") return <Navigate to="/login" replace />;
  return (
    <Shell roleTag="教师端" items={NAV}>
      {children}
    </Shell>
  );
}

export function AppRouter() {
  const { me } = useAuth();
  useEffect(() => {
    document.title = me ? `SigmaMentor 教师端 · ${me.user.displayName}` : "SigmaMentor 教师端";
  }, [me]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <Guard>
            <DashboardPage />
          </Guard>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Guard>
            <DashboardPage />
          </Guard>
        }
      />
      <Route
        path="/students"
        element={
          <Guard>
            <StudentsPage />
          </Guard>
        }
      />
      <Route path="*" element={<Navigate to={me ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}
