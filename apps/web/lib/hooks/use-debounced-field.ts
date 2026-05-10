import { useEffect, useState } from "react";

export function useDebouncedField(
  value: string,
  onChange: (v: string) => void,
  delay = 400,
) {
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), delay);
    return () => clearTimeout(timer);
  }, [draft, value, onChange, delay]);

  return [draft, setDraft] as const;
}
