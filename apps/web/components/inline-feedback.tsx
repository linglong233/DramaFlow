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
      {message ? <div className="inline-feedback inline-feedback-success">{message}</div> : null}
      {error ? <div className="inline-feedback inline-feedback-error">{error}</div> : null}
    </div>
  );
}