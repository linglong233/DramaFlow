/**
 * @fileoverview 内联反馈组件
 * @module web/components
 *
 * 表单操作后的成功/错误内联提示。
 */

interface InlineFeedbackProps {
  message?: string | null;
  error?: string | null;
}

export function InlineFeedback({ message, error }: InlineFeedbackProps) {
  if (!message && !error) {
    return null;
  }

  return (
    <div className="stack stack-gap-2">
      {message ? (
        <div className="inline-feedback inline-feedback-success" role="status" aria-atomic="true">
          <svg className="inline-feedback__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
          </svg>
          <span>{message}</span>
        </div>
      ) : null}
      {error ? (
        <div className="inline-feedback inline-feedback-error" role="alert" aria-atomic="true">
          <svg className="inline-feedback__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" />
          </svg>
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
