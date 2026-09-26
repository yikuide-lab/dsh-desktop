/** StabilityController pure tick — heartbeat soft miss and offline grace */
import type { CollabVision, LoopRoster, StabilityDefaults, StabilityResult } from './types.js';
export declare const DEFAULT_STABILITY: StabilityDefaults;
export declare function tick(roster: LoopRoster, vision: CollabVision | undefined, nowMs: number, defaults?: StabilityDefaults): StabilityResult;
//# sourceMappingURL=stability.d.ts.map