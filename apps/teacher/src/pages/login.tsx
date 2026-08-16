import { Button, useAuth } from "@sigma/ui";
/** 教师端登录（theme-gray） */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

export function LoginPage() {
  const { login, me } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (me && me.user.role === "teacher") nav("/dashboard", { replace: true });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    login.mutate(
      { username, password },
      {
        onSuccess: () => nav("/dashboard", { replace: true }),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="sig">SigmaMentor</span>
          <span className="sub">2σ 导师 · 教师端</span>
        </div>
        <div className="field">
          <label htmlFor="t-login-username">用户名</label>
          <input
            id="t-login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="t-login-password">密码</label>
          <input
            id="t-login-password"
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
          没有账号？
          <Link to="/register" className="link">
            用邀请码注册
          </Link>
        </div>
      </form>
    </div>
  );
}
