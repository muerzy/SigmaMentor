import { Button, useAuth } from "@sigma/ui";
/** 教师端注册：需要邀请码（TEACHER_INVITE_CODE） */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    username: "",
    password: "",
    displayName: "",
    teacherInviteCode: "",
  });
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    register.mutate(
      { ...form, role: "teacher" },
      {
        onSuccess: () => nav("/dashboard", { replace: true }),
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
          <span className="sub">2σ 导师 · 教师注册</span>
        </div>
        <div className="field">
          <label htmlFor="t-reg-name">姓名</label>
          <input
            id="t-reg-name"
            value={form.displayName}
            onChange={set("displayName")}
            required
            maxLength={24}
          />
        </div>
        <div className="field">
          <label htmlFor="t-reg-code">教师邀请码</label>
          <input
            id="t-reg-code"
            value={form.teacherInviteCode}
            onChange={set("teacherInviteCode")}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="t-reg-username">用户名（字母/数字/下划线）</label>
          <input
            id="t-reg-username"
            value={form.username}
            onChange={set("username")}
            required
            minLength={3}
            maxLength={32}
          />
        </div>
        <div className="field">
          <label htmlFor="t-reg-password">密码（≥6 位）</label>
          <input
            id="t-reg-password"
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
