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