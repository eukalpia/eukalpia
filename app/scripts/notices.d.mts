export interface RuntimePackage {
  name: string;
  version: string;
  text: string;
}
export function runtimePackages(root: string): RuntimePackage[];
export function buildNotices(root: string): string;
