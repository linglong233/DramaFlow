import { LoginPanel } from "../../components/login-panel";

export default function LoginPage() {
  return (
    <main className="page-shell">
      <section className="stack" style={{ marginTop: 48 }}>
        <div className="panel" style={{ textAlign: "center" }}>
          <span className="kicker">邮箱密码登录</span>
          <h1 style={{ fontSize: 52, marginBottom: 12 }}>先把团队带进创作台</h1>
          <p className="subhead" style={{ margin: "0 auto" }}>
            登录后可以创建 Team、搭项目、提交版本、发起 AI 任务、进入平台和团队后台。
          </p>
        </div>
        <LoginPanel />
      </section>
    </main>
  );
}

