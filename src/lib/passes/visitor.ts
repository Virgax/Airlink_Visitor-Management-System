/** Shared rules for the public visitor link. Pure. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** A pass accepts visitor input (pre-registration, NDA) while it is active or pending and its window has not ended. */
export function isOpenForVisitor(pass: { status: string; validUntil: Date }, now = new Date()): boolean {
  return (pass.status === "active" || pass.status === "pending_approval") && pass.validUntil > now;
}
