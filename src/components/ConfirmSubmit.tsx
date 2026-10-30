"use client";

/** Submit button that asks the browser's confirm dialog first (destructive actions on plain server-action forms). */
export function ConfirmSubmit({ message, className = "btn-secondary text-danger text-sm", children, ...rest }: { message: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
