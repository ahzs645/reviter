export {};

declare global {
  const __REVITER_PAGES_BUILD_VERSION__: string;

  var __REVITER_STATIC_WORKERS__:
    | {
        rvt?: string;
        ifc?: string;
        dwg?: string;
      }
    | undefined;
}
