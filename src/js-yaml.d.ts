declare module 'js-yaml' {
  /** Opaque js-yaml schema object. */
  type Schema = { readonly __yamlSchema?: never };
  const CORE_SCHEMA: Schema;
  function load(input: string, options?: { schema?: Schema }): unknown;
  function dump(
    input: unknown,
    options?: {
      lineWidth?: number;
      quotingType?: string;
      forceQuotes?: boolean;
    },
  ): string;
  const _default: {
    load: typeof load;
    dump: typeof dump;
    CORE_SCHEMA: typeof CORE_SCHEMA;
  };
  export default _default;
}
