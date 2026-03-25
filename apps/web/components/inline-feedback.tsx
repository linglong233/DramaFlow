interface InlineFeedbackProps {
  message?: string | null;
  error?: string | null;
}

export function InlineFeedback({ message, error }: InlineFeedbackProps) {
  if (!message && !error) {
    return null;
  }

  return (
    <div className="stack stack--tight">
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice notice--error">{error}</div> : null}
    </div>
  );
}