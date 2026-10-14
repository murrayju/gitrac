/**
 * Minimal types for the subset of js-yaml 4.x (a pinned direct dependency)
 * that gitrac uses. Always pass `{ schema: CORE_SCHEMA }` when loading
 * untrusted input (issue frontmatter, config.yaml) so timestamps stay strings.
 * js-yaml 4 never constructs `!!js/*` types, regardless of schema.
 */
declare module 'js-yaml' {
  /** Opaque js-yaml schema object. */
  type Schema = { readonly __yamlSchema?: never };
  const CORE_SCHEMA: Schema;
  function load(input: string, options?: { schema?: Schema }): unknown;
  function dump(input: unknown, options?: { lineWidth?: number }): string;
  const _default: {
    load: typeof load;
    dump: typeof dump;
    CORE_SCHEMA: typeof CORE_SCHEMA;
  };
  export default _default;
}
