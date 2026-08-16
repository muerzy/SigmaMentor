import { Button, useAuth } from "@sigma/ui";
/** 登录页（学生端 · 墨黑） */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

export function LoginPage() {
  const { login, me } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (me && me.user.role === "student") {
    nav("/assignment", { replace: true });
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    login.mutate(
      { username, password },
      {
        onSuccess: () => nav("/assignment", { replace: true }),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="sig">SigmaMentor</span>
          <span className="sub">2σ 导师 · 学生端</span>
        </div>
        <div className="field">
          <label htmlFor="login-username">用户名 / 学号</label>
          <input
            id="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">密码</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <div className="auth-error">{error}</div>}
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? "登录中…" : "登录"}
        </Button>
        <div className="note">
          还没有账号？
          <Link to="/register" className="link">
            注册一个
          </Link>
        </div>
      </form>
    </div>
  );
}
