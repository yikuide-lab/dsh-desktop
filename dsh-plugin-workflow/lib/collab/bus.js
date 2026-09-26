/** In-process CollabBus pub/sub — V2 bridges to AspBridge (in-process loopback or external TCP) */
import { createConnection } from 'node:net';
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
            ...(input.sender_did !== undefined ? { sender_did: input.sender_did } : {}),
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
export function parseAspTcpEndpoint(endpoint) {
    const trimmed = endpoint.trim();
    const withoutScheme = trimmed.replace(/^tcp:\/\//i, '');
    const hostPort = withoutScheme.includes('/')
        ? withoutScheme.slice(0, withoutScheme.indexOf('/'))
        : withoutScheme;
    const lastColon = hostPort.lastIndexOf(':');
    if (lastColon <= 0) {
        throw new Error(`Invalid ASP TCP endpoint (expected host:port): ${endpoint}`);
    }
    const host = hostPort.slice(0, lastColon);
    const port = Number(hostPort.slice(lastColon + 1));
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid ASP TCP endpoint (expected host:port): ${endpoint}`);
    }
    return { host, port };
}
/**
 * Interim external AspBridge: length-prefixed (u32 BE) JSON CollabEnvelope over TCP.
 * Protobuf ASP wire remains a follow-up; this unblocks Host `external` mode + endpoint tests.
 */
export class TcpFramedAspBridge {
    endpoint;
    onError;
    socket;
    connecting;
    buffer = Buffer.alloc(0);
    lastError;
    constructor(endpoint, onError) {
        this.endpoint = endpoint;
        this.onError = onError;
    }
    fail(message) {
        this.lastError = message;
        this.onError?.(message);
    }
    async connect() {
        if (this.socket && !this.socket.destroyed)
            return;
        if (this.connecting)
            return this.connecting;
        const { host, port } = parseAspTcpEndpoint(this.endpoint);
        this.connecting = new Promise((resolve, reject) => {
            const socket = createConnection({ host, port }, () => {
                this.socket = socket;
                this.lastError = undefined;
                this.connecting = undefined;
                resolve();
            });
            socket.on('data', (chunk) => {
                this.buffer = Buffer.concat([this.buffer, chunk]);
                // Receiver side reserved for inbound ASP; drain frames without interpreting yet.
                while (this.buffer.length >= 4) {
                    const len = this.buffer.readUInt32BE(0);
                    if (this.buffer.length < 4 + len)
                        break;
                    this.buffer = this.buffer.subarray(4 + len);
                }
            });
            socket.on('error', (err) => {
                this.fail(err.message);
                this.connecting = undefined;
                reject(err);
            });
            socket.on('close', () => {
                this.socket = undefined;
            });
        });
        return this.connecting;
    }
    async send(envelope) {
        try {
            await this.connect();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.fail(message);
            throw err instanceof Error ? err : new Error(message);
        }
        const socket = this.socket;
        if (!socket || socket.destroyed) {
            const message = `ASP TCP bridge disconnected: ${this.endpoint}`;
            this.fail(message);
            throw new Error(message);
        }
        const body = Buffer.from(JSON.stringify(envelope), 'utf8');
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length, 0);
        await new Promise((resolve, reject) => {
            socket.write(Buffer.concat([header, body]), (err) => {
                if (err) {
                    this.fail(err.message);
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }
    async close() {
        const socket = this.socket;
        this.socket = undefined;
        this.connecting = undefined;
        if (!socket || socket.destroyed)
            return;
        await new Promise((resolve) => {
            socket.end(() => resolve());
        });
    }
}
export function createTcpFramedAspBridge(endpoint, onError) {
    return new TcpFramedAspBridge(endpoint, onError);
}
//# sourceMappingURL=bus.js.map