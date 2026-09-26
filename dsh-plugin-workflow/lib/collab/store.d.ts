/** Collab Loop JSON persistence under $DSH_HOME/collab */
import type { BranchRecord, CollabLoop, CollabVision, HealPlan, LoopAdmin, LoopRoster, TaskPlan } from './types.js';
export declare function ensureCollabRoot(): Promise<string>;
export declare function ensureSecret(): Promise<Buffer>;
export declare function createLoopDir(loopId: string): Promise<string>;
export declare function writeLoopJson(loopId: string, loop: CollabLoop): Promise<void>;
export declare function readLoopJson(loopId: string): Promise<CollabLoop>;
export declare function writeAdminJson(loopId: string, admin: LoopAdmin): Promise<void>;
export declare function readAdminJson(loopId: string): Promise<LoopAdmin>;
export declare function writeRosterJson(loopId: string, roster: LoopRoster): Promise<void>;
export declare function readRosterJson(loopId: string): Promise<LoopRoster>;
export declare function writeVisionJson(loopId: string, vision: CollabVision): Promise<void>;
export declare function readVisionJson(loopId: string): Promise<CollabVision>;
export declare function writeBranchesIndex(loopId: string, branches: BranchRecord[]): Promise<void>;
export declare function readBranchesIndex(loopId: string): Promise<BranchRecord[]>;
export declare function writeBranchYaml(loopId: string, branchId: string, yaml: string): Promise<string>;
export declare function writeHealPending(loopId: string, plan: HealPlan | null): Promise<void>;
export declare function readHealPending(loopId: string): Promise<HealPlan | null>;
export declare function writePlanLatest(loopId: string, plan: TaskPlan): Promise<void>;
export declare function readPlanLatest(loopId: string): Promise<TaskPlan>;
//# sourceMappingURL=store.d.ts.map