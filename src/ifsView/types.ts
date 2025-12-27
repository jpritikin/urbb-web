export { SeatInfo } from '../carpetRenderer.js';

export type PositionTarget =
    | { type: 'panorama' }
    | { type: 'panorama-ui' }
    | { type: 'seat'; cloudId: string }
    | { type: 'star'; offsetX?: number; offsetY?: number }
    | { type: 'supporting'; targetId: string; index: number }
    | { type: 'blended'; cloudId: string; offsetX: number; offsetY: number }
    | { type: 'absolute'; x: number; y: number };

export interface SmoothingConfig {
    position: number;
    scale: number;
    opacity: number;
    blendingDegree: number;
}

export const DEFAULT_SMOOTHING: SmoothingConfig = {
    position: 8,
    scale: 8,
    opacity: 8,
    blendingDegree: 4
};

export const LINEAR_INTERPOLATION_SPEED = 3.0;

export interface CloudAnimatedState {
    cloudId: string;
    x: number;
    y: number;
    scale: number;
    opacity: number;
    blendingDegree: number;
    positionTarget: PositionTarget;
    targetScale: number;
    targetOpacity: number;
    targetBlendingDegree: number;
    smoothing: SmoothingConfig;
}
