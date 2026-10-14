"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
export function SubmitButton({
  children,
  variant,
  disabled = false,
}: {
  children: React.ReactNode;
  variant?: "default" | "outline";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
    >
      {pending ? "Please wait…" : children}
    </Button>
  );
}
