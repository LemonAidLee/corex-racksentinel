/**
 * Generic interface icons: one family only (Phosphor, regular weight).
 * Scenario icons are separate pixel-art assets (components/scenarios).
 */
import {
  ArrowCounterClockwise,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  CheckCircle,
  ClipboardText,
  Crosshair,
  CornersIn,
  CornersOut,
  Info,
  Lightning,
  ListBullets,
  Lock,
  Monitor,
  PaperPlaneRight,
  PresentationChart,
  Pause,
  Play,
  Plugs,
  Question,
  Repeat,
  SpeakerHigh,
  SpeakerSlash,
  Tag,
  Thermometer,
  Warning,
  WarningOctagon,
  Waves,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

const ICONS = {
  play: Play,
  pause: Pause,
  sound: SpeakerHigh,
  mute: SpeakerSlash,
  full: CornersOut,
  exitFull: CornersIn,
  restart: ArrowCounterClockwise,
  help: Question,
  motion: Waves,
  screenshot: Camera,
  close: X,
  left: CaretLeft,
  right: CaretRight,
  up: CaretUp,
  down: CaretDown,
  send: PaperPlaneRight,
  quality: Monitor,
  ok: CheckCircle,
  warn: Warning,
  crit: WarningOctagon,
  info: Info,
  bolt: Lightning,
  temp: Thermometer,
  link: Plugs,
  lock: Lock,
  follow: Crosshair,
  labels: Tag,
  timeline: ListBullets,
  evidence: ClipboardText,
  present: PresentationChart,
  replay: Repeat,
} satisfies Record<string, PhosphorIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, weight = "regular" }: { name: IconName; size?: number; weight?: "regular" | "bold" | "fill" }) {
  const C = ICONS[name];
  return <C size={size} weight={weight} aria-hidden="true" focusable="false" />;
}
