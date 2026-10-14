"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
export function SubmitButton({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? "Please wait…" : children}
    </Button>
  );
}
