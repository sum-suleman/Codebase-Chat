import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-cb-border bg-cb-bg px-3 py-2 text-sm text-cb-text-primary file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-cb-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cb-primary disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
          error && "border-cb-error focus-visible:ring-cb-error",
          className
        )}
        {...props}
        aria-invalid={error ? "true" : props["aria-invalid"]}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };