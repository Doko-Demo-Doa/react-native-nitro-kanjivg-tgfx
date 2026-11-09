// With `withKanjiSvgMetroConfig`, SVGs are bundled as their raw text.
declare module '*.svg' {
  const content: string;
  export default content;
}

// Metro's dynamic-context require (not part of @types/node's NodeRequire).
interface NodeRequire {
  context(
    directory: string,
    deep?: boolean,
    filter?: RegExp
  ): ((id: string) => unknown) & { keys(): string[] };
}
