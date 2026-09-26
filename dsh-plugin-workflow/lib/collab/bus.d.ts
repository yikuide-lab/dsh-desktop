/** In-process CollabBus pub/sub — V2 bridges to AspBridge (in-process loopback or external TCP later) */
import type { CollabEnvelope, CollabPayload } from './types.js';
export type CollabBusHandler = (envelope: CollabEnvelope) => void;
export interface AspBridge {
    send(envelope: CollabEnvelope): Promise<void>;
    close?(): Promise<void>;
}
export type AspBridgeMode = 'in-process' | 'external' | 'disconnected';
export interface AspBridgeStatus {
    mode: AspBridgeMode;
    endpoint?: string;
    lastError?: string;
}
export declare class CollabBus {
    private handlers;
    private aspBridge;
    constructor(aspBridge?: AspBridge);
    subscribe(handler: CollabBusHandler): () => void;
    setAspBridge(bridge: AspBridge | undefined): void;
    getAspBridge(): AspBridge | undefined;
    /** Deliver to in-process subscribers only (no AspBridge re-entry). */
    deliverLocal(envelope: CollabEnvelope): void;
    send(input: {
        from_jid: string;
        to_jid: string;
        payload: CollabPayload;
        id?: string;
        timestamp?: string;
    }): CollabEnvelope;
}
/** Loopback AspBridge — republishes envelopes on the same bus (tests + Host default). */
export declare function createInProcessAspBridge(bus: CollabBus): AspBridge;
/** Test / placeholder external bridge — records envelopes without wire I/O. */
export declare class StubAspBridge implements AspBridge {
    readonly sent: CollabEnvelope[];
    send(envelope: CollabEnvelope): Promise<void>;
}
//# sourceMappingURL=bus.d.ts.map