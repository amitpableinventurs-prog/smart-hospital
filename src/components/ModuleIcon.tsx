import {
  Ambulance,
  ChartColumn,
  Droplet,
  Pill,
  FlaskConical,
  HeartPulse,
  IdCard,
  Package,
  Receipt,
  ShieldCheck,
  Stethoscope,
  UserRoundCheck,
  Users,
  type LucideProps,
} from "lucide-react";

const ICONS = {
  users: Users,
  stethoscope: Stethoscope,
  "user-round-check": UserRoundCheck,
  "heart-pulse": HeartPulse,
  "flask-conical": FlaskConical,
  package: Package,
  receipt: Receipt,
  "id-card": IdCard,
  "shield-check": ShieldCheck,
  ambulance: Ambulance,
  droplet: Droplet,
  pill: Pill,
  chart: ChartColumn,
} as const;

export function ModuleIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = ICONS[name as keyof typeof ICONS] ?? Users;
  return <Icon aria-hidden {...props} />;
}
