/** In-process CollabBus pub/sub — V2 bridges to AspBridge (in-process loopback or external TCP later) */
import { randomUUID } from 'node:crypto';
export class CollabBus {
    handlers = new Set();
    aspBridge;
    constructor(aspBridge) {
        this.aspBridge = aspBridge;
    }
    subscribe(handler) {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }
    setAspBridge(bridge) {
        this.aspBridge = bridge;
    }
    getAspBridge() {
        return this.aspBridge;
    }
    /** Deliver to in-process subscribers only (no AspBridge re-entry). */
    deliverLocal(envelope) {
        for (const handler of this.handlers) {
            handler(envelope);
        }
    }
    send(input) {
        const envelope = {
            id: input.id ?? randomUUID(),
            from_jid: input.from_jid,
            to_jid: input.to_jid,
            timestamp: input.timestamp ?? new Date().toISOString(),
            payload: input.payload,
        };
        this.deliverLocal(envelope);
        const bridge = this.aspBridge;
        if (bridge) {
            void bridge.send(envelope).catch(() => {
                // fire-and-forget; Host may surface bridge errors via asp.status
            });
        }
        return envelope;
    }
}
/** Loopback AspBridge — republishes envelopes on the same bus (tests + Host default). */
export function createInProcessAspBridge(bus) {
    return {
        async send(envelope) {
            bus.deliverLocal(envelope);
        },
    };
}
/** Test / placeholder external bridge — records envelopes without wire I/O. */
export class StubAspBridge {
    sent = [];
    async send(envelope) {
        this.sent.push(envelope);
    }
}
//# sourceMappingURL=bus.js.map