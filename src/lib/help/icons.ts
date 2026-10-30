import { BookOpenCheck, ClipboardList, FileSpreadsheet, LayoutPanelTop, MonitorSmartphone, ScanLine, Settings2, Siren, TicketCheck, UserCircle, Users, type LucideIcon } from "lucide-react";
import type { HelpGuide } from "./guides";

export const HELP_ICONS: Record<HelpGuide["icon"], LucideIcon> = {
  kiosk: MonitorSmartphone,
  scan: ScanLine,
  pass: TicketCheck,
  approve: BookOpenCheck,
  settings: Settings2,
  people: Users,
  form: LayoutPanelTop,
  report: FileSpreadsheet,
  siren: Siren,
  account: UserCircle,
};

export const HELP_LIST_ICON = ClipboardList;
