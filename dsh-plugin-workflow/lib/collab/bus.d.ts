/** In-process CollabBus pub/sub — V2 may bridge to AspBridge */
import type { CollabEnvelope, CollabPayload } from './types.js';
export type CollabBusHandler = (envelope: CollabEnvelope) => void;
export interface AspBridge {
    send(envelope: CollabEnvelope): Promise<void>;
    close?(): Promise<void>;
}
export declare class CollabBus {
    private handlers;
    subscribe(handler: CollabBusHandler): () => void;
    send(input: {
        from_jid: string;
        to_jid: string;
        payload: CollabPayload;
        id?: string;
        timestamp?: string;
    }): CollabEnvelope;
}
/** V1 stub — real ASP wire deferred to V2 */
export declare class StubAspBridge implements AspBridge {
    send(_envelope: CollabEnvelope): Promise<void>;
}
//# sourceMappingURL=bus.d.ts.map