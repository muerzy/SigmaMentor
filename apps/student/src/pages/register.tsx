import { Button, useAuth } from "@sigma/ui";
/** 注册页（学生端）：注册即入班（MVP 单班演示口径） */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: "", password: "", displayName: "", studentNo: "" });
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    register.mutate(
      {
        username: form.username,
        password: form.password,
        displayName: form.displayName,
        role: "student",
        studentNo: form.studentNo || undefined,
      },
      {
        onSuccess: () => nav("/assignment", { replace: true }),
        onError: (err) => setError(err.message),
      },
    );
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="sig">SigmaMentor</span>
          <span className="sub">2σ 导师 · 注册</span>
        </div>
        <div className="field">
          <label htmlFor="reg-name">姓名</label>
          <input
            id="reg-name"
            value={form.displayName}
            onChange={set("displayName")}
            required
            maxLength={24}
          />
        </div>
        <div className="field">
          <label htmlFor="reg-no">学号（可留空自动生成）</label>
          <input id="reg-no" value={form.studentNo} onChange={set("studentNo")} />
        </div>
        <div className="field">
          <label htmlFor="reg-username">用户名（字母/数字/下划线）</label>
          <input
            id="reg-username"
            value={form.username}
            onChange={set("username")}
            required
            minLength={3}
            maxLength={32}
          />
        </div>
        <div className="field">
          <label htmlFor="reg-password">密码（≥6 位）</label>
          <input
            id="reg-password"
            type="password"
            value={form.password}
            onChange={set("password")}
            required
            minLength={6}
          />
        </div>
        {error && <div className="auth-error">{error}</div>}
        <Button type="submit" disabled={register.isPending}>
          {register.isPending ? "注册中…" : "注册并进入"}
        </Button>
        <div className="note">
          已有账号？
          <Link to="/login" className="link">
            去登录
          </Link>
        </div>
      </form>
    </div>
  );
}
