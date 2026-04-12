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
      {message ? <div className="inline-feedback inline-feedback-success" role="status" aria-live="polite">{message}</div> : null}
      {error ? <div className="inline-feedback inline-feedback-error" role="alert">{error}</div> : null}
    </div>
  );
}