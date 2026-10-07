/**
 * Scenario recovery: decides when the simulated operator should acknowledge a latched EPO
 * request, sends them to P0, and finishes the scenario once the controller has answered.
 *
 * This is presentation logic, not controller logic. It never touches the EPO latch: the only
 * way it acts is `runtime.pressReset()`, the same walk-and-press a user's click triggers, so
 * the controller accepts or refuses the press by its normal rules.
 *
 * Phases:
 *   idle        not armed (free play, or a scenario with nothing to acknowledge)
 *   waiting     armed; readings not yet safe, P0 held, or the operator is busy
 *   safe        safe readings with the EPO still latched; held for `dwell` ms so it is visible
 *   dispatched  the operator is on the way to P0 / pressing it
 *   cleared     the EPO request was cleared by a P0 press; result held on screen
 *   done        operator sent back to the desk; the scenario may complete
 */
import { TEMP_CLASS } from "./controller";
import type { ResetOutcome } from "./controller";
import type { SimulationRuntime } from "./runtime";

export type RecoveryPhase = "idle" | "waiting" | "safe" | "dispatched" | "cleared" | "done";

/** Safe readings stay visible, with P7 still latched, this long before the operator goes. */
export const ACK_DWELL_MS = 2000;
/** The accepted reset stays on screen this long before the operator returns to the desk. */
export const RESULT_HOLD_MS = 2000;
/** A dispatched operator who was redirected elsewhere is retried after this long. */
const REDIRECT_GRACE_MS = 600;

export class RecoveryCoordinator {
  phase: RecoveryPhase = "idle";
  /** Operator acknowledgements the coordinator started (for tests and diagnostics). */
  dispatches = 0;
  private dwell = ACK_DWELL_MS;
  private safeSince = 0;
  private dispatchedAt = 0;
  private clearedAt = 0;
  /** The operator was sent but has not pressed yet. */
  private awaitingPress = false;

  constructor(private rt: SimulationRuntime) {}

  /** Something is still to happen before the scenario can complete. */
  get pending(): boolean {
    return this.phase !== "idle" && this.phase !== "done";
  }

  reset(): void {
    this.phase = "idle";
    this.dispatches = 0;
    this.awaitingPress = false;
  }

  /** Enter the recovery phase of a scenario. */
  arm(dwell = ACK_DWELL_MS): void {
    this.dwell = dwell;
    this.phase = "waiting";
    this.update();
  }

  /** Latched, Normal temperature, current below warning, a valid reading, P0 not held. */
  safeToAcknowledge(): boolean {
    const s = this.rt.controller.state;
    return s.epo && s.gotTemp && s.tempClass === TEMP_CLASS.NORMAL && s.latestCurrent < s.warnCurrent && !this.rt.p0Down;
  }

  private get operatorBusy(): boolean {
    return this.rt.agent?.busy ?? false;
  }

  /** Re-evaluate; called by the runtime after every packet, task and clock step. */
  update(): void {
    const rt = this.rt;
    const now = rt.time;
    const epo = rt.controller.state.epo;
    switch (this.phase) {
      case "waiting":
      case "safe":
        if (!epo) {
          // Cleared before the operator was sent (e.g. a manual P0 press): nothing left to do.
          this.toCleared();
          return;
        }
        if (!this.safeToAcknowledge()) {
          this.phase = "waiting";
          return;
        }
        if (this.phase === "waiting") {
          this.phase = "safe";
          this.safeSince = now;
          rt.setStage(
            rt.streaming
              ? { title: "Safe telemetry received · EPO still latched", detail: "Waiting for operator acknowledgement at P0.", tone: "warn" }
              : { title: "Link silent · EPO still latched", detail: "Last readings are safe. P0 works locally without new telemetry.", tone: "warn" },
          );
          return;
        }
        if (now - this.safeSince >= this.dwell && !this.operatorBusy) this.dispatch();
        return;
      case "dispatched":
        if (!epo) this.toCleared();
        else if (this.awaitingPress && rt.agent && !rt.agent.busy && now - this.dispatchedAt > REDIRECT_GRACE_MS) {
          // The operator was sent somewhere else before pressing: try again once things settle.
          this.awaitingPress = false;
          this.phase = "waiting";
        }
        return;
      case "cleared":
        if (now - this.clearedAt >= RESULT_HOLD_MS && !this.operatorBusy) {
          this.phase = "done";
          rt.notify("Returning to monitoring station", undefined, "info");
          rt.agent?.returnToDesk();
          rt.recoveryFinished();
        }
        return;
    }
  }

  private dispatch(): void {
    const rt = this.rt;
    this.phase = "dispatched";
    this.dispatches++;
    this.dispatchedAt = rt.time;
    this.awaitingPress = true;
    rt.notify("Operator moving to P0", "Operator acknowledgement: a new P0 press. The controller checks the conditions again.", "info");
    rt.setStage({ title: "Operator moving to P0", detail: "The same P0 press a person makes. RackSentinel decides.", tone: "info" });
    rt.pressReset(true);
  }

  /** A P0 press was evaluated by the controller. */
  onReset(outcome: ResetOutcome, fromOperator: boolean): void {
    if (!this.pending || outcome === "released") return;
    if (this.phase === "dispatched" && fromOperator) this.awaitingPress = false;
    if (outcome === "accepted") {
      this.toCleared();
    } else if (outcome !== "not-latched" && this.phase === "dispatched" && !this.awaitingPress) {
      // Refused (conditions changed on the way): wait for safe readings again and retry.
      this.phase = "waiting";
    }
  }

  /** The operator pressed P0 (button went down). */
  onOperatorPress(): void {
    if (this.phase === "dispatched") this.rt.setStage({ title: "Operator pressing P0", detail: "New press: the controller checks temperature and current.", tone: "info" });
  }

  private toCleared(): void {
    if (this.phase === "cleared" || this.phase === "done" || this.phase === "idle") return;
    // Someone else's press cleared it while the operator was still on the way: call them off.
    if (this.phase === "dispatched" && this.awaitingPress) this.rt.agent?.cancel();
    this.awaitingPress = false;
    this.phase = "cleared";
    this.clearedAt = this.rt.time;
    this.rt.setStage({ title: "EPO request cleared", detail: "Reset accepted: a new P0 press with safe readings.", tone: "ok" });
  }
}
