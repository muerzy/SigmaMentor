import { Shell, useAuth } from "@sigma/ui";
/** 学生端路由：登录守卫 + 三大页（F1 作业 / F2 诊断 / F3 导师） */
import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { AssignmentDetailPage } from "./pages/assignment-detail";
import { AssignmentsPage } from "./pages/assignments";
import { DiagnosisPage } from "./pages/diagnosis";
import { LoginPage } from "./pages/login";
import { RegisterPage } from "./pages/register";
import { TutorPage } from "./pages/tutor";

const NAV = [
  { to: "/assignment", ni: "F1", label: "作业中心" },
  { to: "/diagnosis", ni: "F2", label: "卡点诊断" },
  { to: "/tutor", ni: "F3", label: "导师对话" },
];

function Guard({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="page-body note">加载中…</div>;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.user.role !== "student") return <Navigate to="/login" replace />;
  return (
    <Shell roleTag="学生端" items={NAV} userMeta={me.student?.studentNo}>
      {children}
    </Shell>
  );
}

export function AppRouter() {
  const { me } = useAuth();

  // 演示数据身份提示（登录后可见）
  useEffect(() => {
    document.title = me ? `SigmaMentor 学生端 · ${me.user.displayName}` : "SigmaMentor 学生端";
  }, [me]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/assignment"
        element={
          <Guard>
            <AssignmentsPage />
          </Guard>
        }
      />
      <Route
        path="/assignment/:id"
        element={
          <Guard>
            <AssignmentDetailPage />
          </Guard>
        }
      />
      <Route
        path="/diagnosis"
        element={
          <Guard>
            <DiagnosisPage />
          </Guard>
        }
      />
      <Route
        path="/tutor"
        element={
          <Guard>
            <TutorPage />
          </Guard>
        }
      />
      <Route path="*" element={<Navigate to={me ? "/assignment" : "/login"} replace />} />
    </Routes>
  );
}
