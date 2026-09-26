/** In-process CollabBus pub/sub — V2 may bridge to AspBridge */
import { randomUUID } from 'node:crypto';
export class CollabBus {
    handlers = new Set();
    subscribe(handler) {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }
    send(input) {
        const envelope = {
            id: input.id ?? randomUUID(),
            from_jid: input.from_jid,
            to_jid: input.to_jid,
            timestamp: input.timestamp ?? new Date().toISOString(),
            payload: input.payload,
        };
        for (const handler of this.handlers) {
            handler(envelope);
        }
        return envelope;
    }
}
/** V1 stub — real ASP wire deferred to V2 */
export class StubAspBridge {
    async send(_envelope) {
        throw new Error('AspBridge not implemented in V1');
    }
}
//# sourceMappingURL=bus.js.map