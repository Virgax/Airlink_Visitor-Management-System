/** Shared rules for the public visitor link. Pure. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

type SelfRegistering = { selfRegistration?: boolean; registeredAt?: Date | null };

/** Invitation link whose visitor still has to fill in their name and details. */
export function registrationPending(pass: SelfRegistering): boolean {
  return Boolean(pass.selfRegistration) && !pass.registeredAt;
}

/**
 * Whether the visitor may still change their pre-registration. A completed invitation link is consumed: whoever
 * opens it later sees the pass but cannot rewrite the data (the NDA has its own, separate, write-once step).
 */
export function canEditFromLink(pass: { status: string; validUntil: Date } & SelfRegistering, now = new Date()): boolean {
  return isOpenForVisitor(pass, now) && !(Boolean(pass.selfRegistration) && Boolean(pass.registeredAt));
}

/** A pass accepts visitor input (pre-registration, NDA) while it is active or pending and its window has not ended. */
export function isOpenForVisitor(pass: { status: string; validUntil: Date }, now = new Date()): boolean {
  return (pass.status === "active" || pass.status === "pending_approval") && pass.validUntil > now;
}
