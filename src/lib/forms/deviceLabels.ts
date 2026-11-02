import type { DeviceLabels } from "@/components/forms/DevicesField";

/** Labels of the devices block from `forms.render.devices.*` (shared with the client editor through its own `t`). */
export function deviceLabels(t: (key: string) => string): DeviceLabels {
  return {
    kinds: { phone: t("devices.kinds.phone"), laptop: t("devices.kinds.laptop"), tablet: t("devices.kinds.tablet"), watch: t("devices.kinds.watch"), other: t("devices.kinds.other") },
    kind: t("devices.kind"),
    id: t("devices.id"),
    idHelp: t("devices.idHelp"),
    model: t("devices.model"),
    color: t("devices.color"),
    add: t("devices.add"),
    remove: t("devices.remove"),
    none: t("devices.none"),
    registered: t("devices.registered"),
  };
}

