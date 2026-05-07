"use client";

import { useState } from "react";

/** 管理操作反馈消息的 Hook，封装成功/错误状态 */
export function useFeedback() {
  const [state, setState] = useState<{ message: string | null; error: string | null }>({
    message: null,
    error: null,
  });

  return {
    feedback: state,
    setFeedback: setState,
    clearFeedback: () => setState({ message: null, error: null }),
  };
}
