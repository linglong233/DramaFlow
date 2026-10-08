import { Suspense } from "react";
import { AuthShell } from "../../components/auth-shell";
import { LoadingSkeleton } from "../../components/loading-skeleton";
import { ResetPasswordForm } from "../../components/reset-password-form";

export default function ResetPasswordPage() {
  return <AuthShell><Suspense fallback={<LoadingSkeleton rows={4} />}><ResetPasswordForm /></Suspense></AuthShell>;
}
