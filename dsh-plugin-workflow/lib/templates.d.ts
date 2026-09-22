/**
 * Built-in workflow templates for the Desktop UI.
 */
export interface WorkflowTemplateDefinition {
    id: string;
    name: string;
    description: string;
    category: 'development' | 'devops' | 'analysis' | 'custom';
    yaml: string;
    /** Built-in catalog entries are true; user-saved templates are false/omitted. */
    builtin?: boolean;
}
/** Ship common templates with the canonical apiVersion. */
export declare function listBuiltinTemplates(): WorkflowTemplateDefinition[];
//# sourceMappingURL=templates.d.ts.map