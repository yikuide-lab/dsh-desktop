/**
 * Optional AWF account session (shared by the desktop plugins and awf-node).
 *
 * 注册/登录（邮箱+密码、手机号+验证码）直接完成，免去「先去平台复制 token」的
 * 手工步骤。会话文件 awf-auth.json（0600，与 awf.json 同目录）只存 refresh
 * token 与短时效 access token —— **密码绝不落盘**；调用方只见指纹。
 * Token 解析链：env AWF_API_TOKEN > 手动保存 token > 登录会话（自动刷新）。
 * 退出登录会尽力调用平台 POST /api/auth/logout 吊销当前会话的 refresh token
 * （网络/HTTP 失败一律吞掉），随后始终清除本地会话文件。
 * 微信登录需要平台配置微信开放平台应用（GET /api/auth/methods 如实上报），
 * 未配置前客户端如实显示不可用。
 */
import type { AwfFetch } from './client.js';
export interface AwfAuthOptions {
    readonly stateDir: string;
    readonly fetchImpl?: AwfFetch;
    readonly env?: Record<string, string | undefined>;
}
export interface AwfAuthSession {
    readonly email: string;
    readonly displayName: string;
    readonly refreshToken: string;
    readonly accessToken: string;
    readonly accessTokenExpiresAt: string;
}
export interface AwfAuthStatusView {
    readonly hasSession: boolean;
    readonly email?: string;
    readonly displayName?: string;
    readonly tokenFingerprint?: string;
    readonly accessTokenExpiresAt?: string;
    /** 失败时携带（与 AwfConnectionResult 字段对齐）；成功时缺省。 */
    readonly errorKind?: string;
    readonly errorMessage?: string;
}
export interface AwfAuthMethods {
    readonly email: boolean;
    readonly phone: boolean;
    readonly wechat: boolean;
    readonly wechatReason?: string;
}
/** 会话文件（0600，与 awf.json 同目录）。 */
export declare function awfAuthSessionPath(stateDir: string): string;
export declare function readAuthSession(stateDir: string): Promise<AwfAuthSession | null>;
export declare function awfAuthRegister(options: AwfAuthOptions, input: {
    email: string;
    password: string;
    displayName?: string;
}): Promise<AwfAuthStatusView>;
export declare function awfAuthLogin(options: AwfAuthOptions, input: {
    email: string;
    password: string;
}): Promise<AwfAuthStatusView>;
export declare function awfAuthSendPhoneCode(options: AwfAuthOptions, phone: string): Promise<void>;
export declare function awfAuthPhoneLogin(options: AwfAuthOptions, input: {
    phone: string;
    code: string;
}): Promise<AwfAuthStatusView>;
/**
 * 退出登录：有会话时尽力 POST /api/auth/logout 吊销当前 refresh token
 * （Bearer access token 鉴权；网络/HTTP 失败 —— 含 access token 过期的 401 —— 一律吞掉），
 * 随后始终清除本地会话文件。
 */
export declare function awfAuthLogout(options: AwfAuthOptions): Promise<void>;
export declare function toAuthStatus(session: AwfAuthSession | null): AwfAuthStatusView;
/** 当前账号状态（无 token 明文，仅指纹）。 */
export declare function awfAuthStatus(options: AwfAuthOptions): Promise<AwfAuthStatusView>;
/** 平台登录方式能力（微信是否可用由平台如实上报）。 */
export declare function awfAuthMethods(options: AwfAuthOptions): Promise<AwfAuthMethods>;
/**
 * 当前可用的会话 access token：临近过期自动刷新（refresh 旋转后立即落盘）。
 * 无会话或刷新失败（refresh 失效则清会话）返回 null，由调用方回退其他凭据源。
 */
export declare function awfAuthAccessToken(options: AwfAuthOptions): Promise<string | null>;
/** 强制刷新会话；失败（refresh 失效/过期）清会话并返回 null。 */
export declare function awfAuthRefresh(options: AwfAuthOptions): Promise<string | null>;
//# sourceMappingURL=auth.d.ts.map