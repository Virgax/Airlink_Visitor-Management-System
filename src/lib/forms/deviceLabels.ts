import type { DeviceLabels } from "@/components/forms/DevicesField";

/** Labels of the devices block from `forms.render.devices.*` (shared with the client editor through its own `t`). */
export function deviceLabels(t: (key: string) => string): DeviceLabels {
  return {
    kinds: { phone: t("devices.kinds.phone"), laptop: t("devices.kinds.laptop"), tablet: t("devices.kinds.tablet"), watch: t("devices.kinds.watch"), other: t("devices.kinds.other") },
    kind: t("devices.kind"),
    imei: t("devices.imei"),
    imeiHelp: t("devices.imeiHelp"),
    serial: t("devices.serial"),
    model: t("devices.model"),
    color: t("devices.color"),
    capacity: t("devices.capacity"),
    capacityHints: { phone: t("devices.capacityHints.phone"), laptop: t("devices.capacityHints.laptop"), tablet: t("devices.capacityHints.tablet"), watch: t("devices.capacityHints.watch"), other: t("devices.capacityHints.other") },
    add: t("devices.add"),
    remove: t("devices.remove"),
    none: t("devices.none"),
    registered: t("devices.registered"),
  };
}
