/** In-process CollabBus pub/sub — V2 bridges to AspBridge (in-process / external TCP|TLS + ASP protobuf) */
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
    tls?: boolean;
    codec?: AspWireCodec;
    authenticated?: boolean;
}
export type AspWireCodec = 'protobuf' | 'json';
export interface AspTlsOptions {
    /** PEM CA bundle path or inline PEM; omit for system trust store. */
    ca?: string | Buffer;
    cert?: string | Buffer;
    key?: string | Buffer;
    servername?: string;
    rejectUnauthorized?: boolean;
}
export interface AspAuthOptions {
    jid: string;
    password: string;
    mechanism?: 'PLAIN';
}
export interface AspBridgeOptions {
    onError?: (message: string) => void;
    /** Deliver inbound ASP envelopes (after auth) to Host/bus. */
    onInbound?: (envelope: CollabEnvelope) => void;
    /** Default `protobuf` (ASP AgentStreamMessage). `json` kept for interim tests. */
    codec?: AspWireCodec;
    tls?: boolean | AspTlsOptions;
    auth?: AspAuthOptions;
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
        sender_did?: string;
    }): CollabEnvelope;
}
/** Loopback AspBridge — republishes envelopes on the same bus (tests + Host default). */
export declare function createInProcessAspBridge(bus: CollabBus): AspBridge;
/** Test / placeholder external bridge — records envelopes without wire I/O. */
export declare class StubAspBridge implements AspBridge {
    readonly sent: CollabEnvelope[];
    send(envelope: CollabEnvelope): Promise<void>;
}
export interface ParsedAspEndpoint {
    host: string;
    port: number;
    tls: boolean;
}
export declare function parseAspTcpEndpoint(endpoint: string): ParsedAspEndpoint;
/**
 * External AspBridge: length-prefixed ASP AgentStreamMessage (protobuf) over TCP or TLS.
 * Optional PLAIN auth handshake matches Python AgentClient / Rust ASP server.
 */
export declare class TcpFramedAspBridge implements AspBridge {
    readonly endpoint: string;
    readonly codec: AspWireCodec;
    readonly useTls: boolean;
    private readonly options;
    private socket;
    private connecting;
    private buffer;
    private awaitingAuth;
    private authResolve;
    private authReject;
    lastError: string | undefined;
    authenticated: boolean;
    constructor(endpoint: string, options?: AspBridgeOptions | ((message: string) => void));
    private fail;
    private writeFrame;
    private handleFrame;
    private onData;
    private openSocket;
    private authenticate;
    connect(): Promise<void>;
    send(envelope: CollabEnvelope): Promise<void>;
    close(): Promise<void>;
}
export declare function createTcpFramedAspBridge(endpoint: string, options?: AspBridgeOptions | ((message: string) => void)): TcpFramedAspBridge;
//# sourceMappingURL=bus.d.ts.map