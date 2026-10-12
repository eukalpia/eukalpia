export const MAX_COVER_BYTES: number;
export function coverSvg(
  frames: { mime: string; base64: string }[],
  o: { width: number; height: number; seconds: number; title: string; description: string },
): string;
export function checkCover(svg: string): string[];
