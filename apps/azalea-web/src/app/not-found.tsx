import { ErrorShell } from "@/components/ErrorShell";

export default function NotFound() {
  return (
    <ErrorShell
      code="404"
      title="Page not found"
      message="This URL does not exist. Sign in or open your account."
      primaryHref="/login"
      primaryLabel="Sign in"
      secondaryHref="/account"
      secondaryLabel="Account"
    />
  );
}
