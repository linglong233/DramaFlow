import { Suspense } from "react";
import { AuthShell } from "../../components/auth-shell";
import { LoginPanel } from "../../components/login-panel";
import { LoadingSkeleton } from "../../components/loading-skeleton";

export default function LoginPage() {
  return <AuthShell><Suspense fallback={<LoadingSkeleton rows={4} />}><LoginPanel /></Suspense></AuthShell>;
}
