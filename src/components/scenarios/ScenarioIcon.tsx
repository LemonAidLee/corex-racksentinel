"use client";
import { useSyncExternalStore } from "react";
import { ICON_SIZE, scenarioIconUrl } from "./scenarioIcons";

const noSubscribe = () => () => {};

/** Decorative pixel-art scenario icon; the surrounding control carries the accessible name. */
export function ScenarioIcon({ id, size = ICON_SIZE }: { id: string; size?: number }) {
  // generated from a canvas on the client; the server renders an empty placeholder of the same size
  const src = useSyncExternalStore(noSubscribe, () => scenarioIconUrl(id), () => null);
  if (!src) return <span className="scn-icon" style={{ width: size, height: size }} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element -- generated data URL, not an optimisable asset
  return <img className="scn-icon" src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
