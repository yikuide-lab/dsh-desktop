/**
 * User-saved workflow templates persisted under stateDir/user-templates.
 */
import type { WorkflowTemplateDefinition } from './templates.js';
export interface UserTemplateRecord extends WorkflowTemplateDefinition {
    readonly builtin: false;
    readonly updatedAt: string;
    readonly sourceWorkflowName?: string;
}
export declare function userTemplatesDir(stateDir: string): string;
export declare function loadUserTemplates(stateDir: string): Promise<UserTemplateRecord[]>;
export declare function normalizeUserTemplate(raw: unknown): UserTemplateRecord | null;
export declare function writeUserTemplate(stateDir: string, template: UserTemplateRecord): Promise<UserTemplateRecord>;
export declare function removeUserTemplate(stateDir: string, id: string): Promise<boolean>;
export declare function allocateUserTemplateId(preferred: string, existingIds: readonly string[]): string;
export type { WorkflowTemplateDefinition };
//# sourceMappingURL=user-templates.d.ts.map