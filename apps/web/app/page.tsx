import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="panel">
          <span className="kicker">导演工作流 x AI 协作台</span>
          <h1 className="headline">把剧本、分镜、素材和审批放进同一个创作引擎。</h1>
          <p className="subhead">
            DramaFlow 面向导演与工作室，把短剧从想法到分镜、从讨论到版本、从镜头到素材产出的全过程沉到一个可协作、可审阅、可追溯的平台里。
          </p>
          <div className="cta-row">
            <Link className="primary-btn" href="/login">
              进入平台
            </Link>
            <Link className="secondary-btn" href="/dashboard">
              查看工作台
            </Link>
          </div>
        </div>
        <div className="stack">
          <div className="panel">
            <div className="info-strip">
              <div>
                <div className="tag">AI 剧本</div>
                <p>支持兼容 completions 风格文本模型，生成剧本初稿与分镜。</p>
              </div>
              <div>
                <div className="tag">版本协作</div>
                <p>每次提交都沉淀版本快照、讨论线程与审批状态。</p>
              </div>
              <div>
                <div className="tag">双存储</div>
                <p>生产走 S3，对开发和轻量部署保留本地磁盘实现。</p>
              </div>
            </div>
          </div>
          <div className="panel">
            <h2>首版包含</h2>
            <div className="stack muted">
              <span>用户注册登录、团队/项目管理</span>
              <span>剧本生成、分镜生成、生图、生视频任务</span>
              <span>版本管理、多人评论、审核队列、管理后台</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

