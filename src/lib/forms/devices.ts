import type { Device } from "@/lib/forms/schema";

/** One line describing a device, for lists and the kiosk. */
export function describeDevice(d: Device, labels: { kinds: Record<Device["kind"], string>; serial: string }): string {
  const parts = [labels.kinds[d.kind], d.model || "—", d.color || "—"];
  if (d.capacity) parts.push(d.capacity);
  if (d.imei) parts.push(`IMEI ${d.imei}`);
  if (d.serial && d.serial !== d.imei) parts.push(`${labels.serial} ${d.serial}`);
  return parts.join(" · ");
}

