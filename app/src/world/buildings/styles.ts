export type StyleId = 'artdeco' | 'modernist' | 'industrial' | 'glass';

export interface BuildingStyle {
  floorHeight: [number, number];
  bayWidth: [number, number];
  height: [number, number];
  setbacks: boolean;
  /** Stable index written into the `aBuilding` vertex attribute for the facade shader. */
  index: number;
}

export const STYLES: Record<StyleId, BuildingStyle> = {
  artdeco: { floorHeight: [3.8, 4.2], bayWidth: [2.6, 3.2], height: [60, 220], setbacks: true, index: 0 },
  modernist: { floorHeight: [3.6, 3.9], bayWidth: [3.0, 4.2], height: [30, 120], setbacks: false, index: 1 },
  industrial: { floorHeight: [4.6, 5.4], bayWidth: [3.6, 4.8], height: [12, 40], setbacks: false, index: 2 },
  glass: { floorHeight: [3.8, 4.0], bayWidth: [1.5, 1.8], height: [80, 260], setbacks: true, index: 3 },
};

export const STYLE_IDS: readonly StyleId[] = ['artdeco', 'modernist', 'industrial', 'glass'];
