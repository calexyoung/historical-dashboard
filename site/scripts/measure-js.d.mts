export declare const JS_BUDGET: { floorBytes: number; budgetBytes: number; explorerBytes: number };
export declare function measureJs(pageUrl: string): Promise<{
  scripts: number;
  files: { src: string; gzipBytes: number; own: boolean }[];
  inlineGzipBytes: number;
  gzipBytes: number;
  frameworkGzipBytes: number;
}>;
