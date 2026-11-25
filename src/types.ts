export type OutputFormat = "text" | "json" | "markdown";
export interface ApiLifecycle {
  since?: string;
  deprecated?: boolean;
  deprecationMessage?: string;
  replacement?: string;
}
export interface Field extends ApiLifecycle {
  name: string;
  type: string;
  optional: boolean;
  description: string;
  defaultValue?: string;
  values?: (string | number | boolean)[];
}
export interface CssVar {
  name: string;
  defaultValue?: string;
  darkValue?: string;
  description: string;
}
export interface Demo {
  name: string;
  aliases: string[];
  title: string;
  section: string;
  description: string;
  language: string;
  code: string;
  blocks: { language: string; code: string }[];
}
export interface Component extends ApiLifecycle {
  name: string;
  id: string;
  label: string;
  category: string;
  categoryId: string;
  kind: "component" | "hook" | "utility";
  description: string;
  importFrom: string;
  source: string;
  docPath?: string;
  doc: string;
  demoSource?: string;
  props: Field[];
  events: Field[];
  slots: Field[];
  methods: { name: string; description: string; type: string }[];
  cssVars: CssVar[];
  demos: Demo[];
  allowUnknownProps: boolean;
}
export interface Knowledge {
  schemaVersion: 1;
  library: "daisu-ui";
  version: string;
  generatedAt: string;
  source: { commit: string | null; dirty: boolean; digest: string };
  guides?: Record<string, { title: string; path: string; content: string }>;
  peerDependencies: Record<string, string>;
  publicExports: Record<string, string[]>;
  components: Component[];
  cssVars: CssVar[];
  changelog: {
    version: string;
    date?: string;
    content: string;
    components: string[];
  }[];
}
export interface QueryOptions {
  limit?: number;
  version?: string;
  cwd?: string;
}
export interface ResolvedKnowledge {
  data: Knowledge;
  version: string;
  versionSource: string;
  warnings: string[];
}
export interface Issue {
  file: string;
  line: number;
  column: number;
  rule: string;
  severity: "warning" | "error";
  message: string;
}
export interface ServerDefinition {
  command: string;
  args: string[];
}
