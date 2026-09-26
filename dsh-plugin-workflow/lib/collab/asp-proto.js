/**
 * Minimal ASP v1 AgentStreamMessage protobuf codec (no codegen dependency).
 * Wire: sibling ai-agent-protocol/proto/agent_protocol.proto
 * Framing (elsewhere): u32 BE length + SerializeToString bytes.
 */
const SHOW_TO_ENUM = {
    ONLINE: 0,
    AWAY: 1,
    DND: 2,
    XA: 3,
    OFFLINE: 4,
};
const ENUM_TO_SHOW = ['ONLINE', 'AWAY', 'DND', 'XA', 'OFFLINE'];
function encodeVarint(value) {
    let n = typeof value === 'bigint' ? value : BigInt(value);
    if (n < 0n)
        throw new Error('varint must be non-negative');
    const parts = [];
    while (n >= 0x80n) {
        parts.push(Number(n & 0x7fn) | 0x80);
        n >>= 7n;
    }
    parts.push(Number(n));
    return Buffer.from(parts);
}
function encodeKey(field, wireType) {
    return encodeVarint((field << 3) | wireType);
}
function encodeBytesField(field, data) {
    return Buffer.concat([encodeKey(field, 2), encodeVarint(data.length), data]);
}
function encodeStringField(field, value) {
    return encodeBytesField(field, Buffer.from(value, 'utf8'));
}
function encodeInt64Field(field, value) {
    return Buffer.concat([encodeKey(field, 0), encodeVarint(BigInt(Math.trunc(value)))]);
}
function encodeBoolField(field, value) {
    return Buffer.concat([encodeKey(field, 0), encodeVarint(value ? 1 : 0)]);
}
function encodeEnumField(field, value) {
    return Buffer.concat([encodeKey(field, 0), encodeVarint(value)]);
}
function encodeSubmessage(field, body) {
    return encodeBytesField(field, body);
}
function encodeAuthRequest(mechanism, credentials) {
    return Buffer.concat([
        encodeStringField(1, mechanism),
        encodeBytesField(2, credentials),
    ]);
}
function encodeAuthResponse(success, errorMessage, boundResource) {
    const parts = [encodeBoolField(1, success)];
    if (errorMessage)
        parts.push(encodeStringField(2, errorMessage));
    if (boundResource)
        parts.push(encodeStringField(3, boundResource));
    return Buffer.concat(parts);
}
function encodeAgentMessage(payload) {
    const parts = [
        encodeEnumField(1, 0), // NORMAL
    ];
    if (payload.thread_id)
        parts.push(encodeStringField(2, payload.thread_id));
    parts.push(encodeStringField(3, payload.body));
    return Buffer.concat(parts);
}
function encodeAgentPresence(payload) {
    const parts = [encodeEnumField(1, SHOW_TO_ENUM[payload.show] ?? 0)];
    if (payload.status)
        parts.push(encodeStringField(2, payload.status));
    return Buffer.concat(parts);
}
function encodeAgentIq(payload) {
    const rpc = Buffer.concat([
        encodeStringField(1, payload.name),
        encodeStringField(2, JSON.stringify(payload.data ?? {})),
    ]);
    return Buffer.concat([
        encodeEnumField(1, 1), // SET
        encodeStringField(2, payload.name),
        encodeSubmessage(4, rpc), // rpc
    ]);
}
/** Encode CollabEnvelope as ASP AgentStreamMessage bytes. */
export function encodeAgentStreamMessage(envelope) {
    const ts = Date.parse(envelope.timestamp);
    const timestamp = Number.isFinite(ts) ? ts : Date.now();
    const parts = [
        encodeStringField(1, envelope.id),
        encodeStringField(2, envelope.from_jid),
        encodeStringField(3, envelope.to_jid),
        encodeInt64Field(4, timestamp),
    ];
    switch (envelope.payload.kind) {
        case 'message':
            parts.push(encodeSubmessage(12, encodeAgentMessage(envelope.payload)));
            break;
        case 'presence':
            parts.push(encodeSubmessage(13, encodeAgentPresence(envelope.payload)));
            break;
        case 'iq':
            parts.push(encodeSubmessage(14, encodeAgentIq(envelope.payload)));
            break;
    }
    return Buffer.concat(parts);
}
/** Encode PLAIN auth handshake AgentStreamMessage. */
export function encodeAuthRequestMessage(input) {
    const credentials = Buffer.from(`\0${input.from_jid}\0${input.password}`, 'utf8');
    return Buffer.concat([
        encodeStringField(1, input.id),
        encodeStringField(2, input.from_jid),
        encodeStringField(3, 'server'),
        encodeInt64Field(4, input.timestampMs ?? Date.now()),
        encodeSubmessage(10, encodeAuthRequest('PLAIN', credentials)),
    ]);
}
function readVarint(cursor) {
    let result = 0n;
    let shift = 0n;
    while (cursor.offset < cursor.buf.length) {
        const byte = cursor.buf[cursor.offset++];
        result |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0)
            return result;
        shift += 7n;
        if (shift > 70n)
            throw new Error('varint too long');
    }
    throw new Error('truncated varint');
}
function readLengthDelimited(cursor) {
    const len = Number(readVarint(cursor));
    if (len < 0 || cursor.offset + len > cursor.buf.length) {
        throw new Error('truncated length-delimited field');
    }
    const slice = cursor.buf.subarray(cursor.offset, cursor.offset + len);
    cursor.offset += len;
    return slice;
}
function decodeFields(buf) {
    const cursor = { buf, offset: 0 };
    const fields = new Map();
    while (cursor.offset < cursor.buf.length) {
        const key = Number(readVarint(cursor));
        const field = key >>> 3;
        const wireType = key & 0x7;
        const entry = { wireType };
        if (wireType === 0) {
            entry.varint = readVarint(cursor);
        }
        else if (wireType === 2) {
            entry.bytes = readLengthDelimited(cursor);
        }
        else if (wireType === 1) {
            cursor.offset += 8;
        }
        else if (wireType === 5) {
            cursor.offset += 4;
        }
        else {
            throw new Error(`unsupported wire type ${wireType}`);
        }
        const list = fields.get(field) ?? [];
        list.push(entry);
        fields.set(field, list);
    }
    return fields;
}
function firstString(fields, field) {
    const entry = fields.get(field)?.[0];
    if (!entry?.bytes)
        return undefined;
    return entry.bytes.toString('utf8');
}
function firstBytes(fields, field) {
    return fields.get(field)?.[0]?.bytes;
}
function firstVarint(fields, field) {
    const v = fields.get(field)?.[0]?.varint;
    return v === undefined ? undefined : Number(v);
}
function firstBool(fields, field) {
    const v = firstVarint(fields, field);
    return v === undefined ? undefined : v !== 0;
}
export function decodeAuthResponseMessage(buf) {
    const fields = decodeFields(buf);
    const authBytes = firstBytes(fields, 11);
    if (!authBytes)
        return undefined;
    const auth = decodeFields(authBytes);
    const result = {
        success: firstBool(auth, 1) ?? false,
    };
    const err = firstString(auth, 2);
    if (err !== undefined)
        result.error_message = err;
    const bound = firstString(auth, 3);
    if (bound !== undefined)
        result.bound_resource = bound;
    return result;
}
function decodeMessagePayload(buf) {
    const fields = decodeFields(buf);
    const thread = firstString(fields, 2);
    const text = firstString(fields, 3);
    const json = firstString(fields, 4);
    const body = text ?? json ?? '';
    const payload = { kind: 'message', body };
    if (thread)
        payload.thread_id = thread;
    return payload;
}
function decodePresencePayload(buf) {
    const fields = decodeFields(buf);
    const showIdx = firstVarint(fields, 1) ?? 0;
    const show = ENUM_TO_SHOW[showIdx] ?? 'ONLINE';
    const status = firstString(fields, 2);
    const payload = { kind: 'presence', show };
    if (status)
        payload.status = status;
    return payload;
}
function decodeIqPayload(buf) {
    const fields = decodeFields(buf);
    const requestId = firstString(fields, 2) ?? 'iq';
    const rpcBytes = firstBytes(fields, 4);
    if (rpcBytes) {
        const rpc = decodeFields(rpcBytes);
        const name = firstString(rpc, 1) ?? requestId;
        const argsJson = firstString(rpc, 2);
        let data;
        if (argsJson) {
            try {
                data = JSON.parse(argsJson);
            }
            catch {
                data = argsJson;
            }
        }
        return data === undefined ? { kind: 'iq', name } : { kind: 'iq', name, data };
    }
    return { kind: 'iq', name: requestId };
}
/** Decode ASP AgentStreamMessage bytes into a CollabEnvelope (non-auth payloads). */
export function decodeAgentStreamMessage(buf) {
    const fields = decodeFields(buf);
    const id = firstString(fields, 1);
    const from_jid = firstString(fields, 2);
    const to_jid = firstString(fields, 3);
    if (!id || from_jid === undefined || to_jid === undefined)
        return undefined;
    if (firstBytes(fields, 10) || firstBytes(fields, 11))
        return undefined;
    let payload;
    const messageBytes = firstBytes(fields, 12);
    if (messageBytes)
        payload = decodeMessagePayload(messageBytes);
    const presenceBytes = firstBytes(fields, 13);
    if (presenceBytes)
        payload = decodePresencePayload(presenceBytes);
    const iqBytes = firstBytes(fields, 14);
    if (iqBytes)
        payload = decodeIqPayload(iqBytes);
    if (!payload)
        return undefined;
    const ts = firstVarint(fields, 4);
    return {
        id,
        from_jid,
        to_jid,
        timestamp: new Date(ts ?? Date.now()).toISOString(),
        payload,
    };
}
/** Length-prefix a protobuf payload (ASP stream frame). */
export function frameAspPayload(payload) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}
/** Encode auth response helper for test servers. */
export function encodeAuthResponseMessage(input) {
    return Buffer.concat([
        encodeStringField(1, input.id),
        encodeStringField(2, input.from_jid ?? 'server'),
        encodeStringField(3, input.to_jid),
        encodeInt64Field(4, input.timestampMs ?? Date.now()),
        encodeSubmessage(11, encodeAuthResponse(input.success, input.error_message, input.bound_resource)),
    ]);
}
//# sourceMappingURL=asp-proto.js.map