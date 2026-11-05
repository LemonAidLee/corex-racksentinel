"use client";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode, type CSSProperties } from "react";
import type { Game } from "@/scene/game";
import type { AnchorName } from "@/scene/layout";
import type { SimulationRuntime } from "@/sim/runtime";

export const RuntimeContext = createContext<SimulationRuntime | null>(null);
export const GameContext = createContext<Game | null>(null);

export function useRuntime(): SimulationRuntime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error("RuntimeContext missing");
  return rt;
}

export function useSim() {
  const rt = useRuntime();
  return useSyncExternalStore(rt.subscribe, rt.getSnapshot, rt.getSnapshot);
}

export const useGame = () => useContext(GameContext);

/** A DOM element that the game loop keeps glued to a world anchor (no React re-renders per frame). */
export function Anchored({
  at,
  place = "point",
  gap = 16,
  className,
  style,
  children,
  ...rest
}: {
  at: AnchorName;
  place?: "right" | "left" | "above" | "below" | "point";
  gap?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const game = useGame();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!game || !ref.current) return;
    return game.addAnchor(ref.current, at, place, gap);
  }, [game, at, place, gap]);
  return (
    <div ref={ref} className={`anchored ${className ?? ""}`} style={{ visibility: game ? undefined : "hidden", ...style }} {...rest}>
      {children}
    </div>
  );
}
