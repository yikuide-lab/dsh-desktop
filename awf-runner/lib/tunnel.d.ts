/**
 * AWF tunnel client — connects to wss://host/api/tunnel/ws with executor
 * token and runs the frame protocol, exposing a local OpenAI-compatible
 * HTTP server (default :8787) for workloads.
 *
 * Frame protocol (Phase 3a):
 *  - platform→node: {type:"request", id, method, path, headers, body_b64}
 *  - node→platform: {type:"response", id, status, headers, body_b64, done} (streaming = multiple done:false then done:true)
 *  - node→platform: {type:"error", id, message}
 *  - ping/pong: platform pings every 30s, read deadline 90s (gorilla handles pong)
 */
import { WebSocket } from 'ws';
import type { AwfFetch } from './awf/client.js';
export type TunnelFrame = {
    type: 'request';
    id: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body_b64: string;
} | {
    type: 'response';
    id: string;
    status: number;
    headers: Record<string, string>;
    body_b64: string;
    done: boolean;
} | {
    type: 'error';
    id: string;
    message: string;
} | {
    type: 'ping';
} | {
    type: 'pong';
};
export interface TunnelClientOptions {
    /** State directory (where awf.json, awf-executor.json live). */
    readonly stateDir: string;
    /** Local port to serve OpenAI-compatible endpoint (default 8787). */
    readonly localPort?: number;
    /** Logger. */
    readonly log?: (message: string) => void;
    /** Test seams. */
    readonly fetchImpl?: AwfFetch;
    readonly env?: Record<string, string | undefined>;
    readonly wsImpl?: typeof WebSocket;
}
export interface TunnelClientHandle {
    /** Start the tunnel (connect WS, start local HTTP server). */
    start(): Promise<void>;
    /** Stop the tunnel (close WS, close HTTP server). */
    stop(): Promise<void>;
    /** Current status. */
    status(): TunnelClientStatus;
}
export interface TunnelClientStatus {
    readonly connected: boolean;
    readonly localPort: number;
    readonly executorId: number | null;
    readonly since: string | null;
    readonly error: string | null;
}
export declare function createTunnelClient(options: TunnelClientOptions): TunnelClientHandle;
//# sourceMappingURL=tunnel.d.ts.map