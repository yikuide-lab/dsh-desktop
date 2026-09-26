/** Collab Loop filesystem path resolution */
export declare const COLLAB_DIR_NAME = "collab";
export declare const SECRET_FILE_NAME = "secret";
export declare function resolveDshHome(): string;
export declare function resolveCollabRoot(): string;
export declare function resolveGlobalSecretPath(): string;
export declare function resolveLoopDir(loopId: string): string;
export declare function resolveLoopFile(loopId: string, ...segments: string[]): string;
//# sourceMappingURL=paths.d.ts.map