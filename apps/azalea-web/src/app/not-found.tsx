import { ErrorShell } from "@/components/ErrorShell";

export default function NotFound() {
  return (
    <ErrorShell
      code="404"
      title="Page not found"
      message="This URL does not exist or was moved. Check the address, or head back to the site."
      primaryHref="/"
      primaryLabel="Back home"
      secondaryHref="/download"
      secondaryLabel="Download Azalea"
    />
  );
}
