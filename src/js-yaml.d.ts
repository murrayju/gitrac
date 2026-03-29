declare module 'js-yaml' {
  function load(input: string): unknown;
  function dump(
    input: unknown,
    options?: {
      lineWidth?: number;
      quotingType?: string;
      forceQuotes?: boolean;
    },
  ): string;
  const _default: { load: typeof load; dump: typeof dump };
  export default _default;
}
