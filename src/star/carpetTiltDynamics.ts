import { REGULATION_STANCE_LIMIT } from '../simulator/messageOrchestrator.js';
import { MAX_TILT } from './carpetRenderer.js';

export const UNREGULATED_TILT = 20;

export interface TiltState {
    tiltAngle: number;
    unregulatedSign: number;
    unregulatedTime: number;
}

export function initialTiltState(): TiltState {
    return { tiltAngle: 0, unregulatedSign: 0, unregulatedTime: 0 };
}

export function updateTilt(state: TiltState, stance: number, tiltSign: number, deltaTime: number): TiltState {
    const isUnregulated = Math.abs(stance) > REGULATION_STANCE_LIMIT;
    const clampedStance = Math.max(-REGULATION_STANCE_LIMIT, Math.min(REGULATION_STANCE_LIMIT, stance));
    const regulatedTilt = (clampedStance / REGULATION_STANCE_LIMIT) * MAX_TILT;
    const stanceSign = isUnregulated ? Math.sign(stance) : 0;
    const wasUnregulated = state.unregulatedSign !== 0;
    const signChanged = isUnregulated && wasUnregulated && stanceSign !== state.unregulatedSign;

    let { tiltAngle, unregulatedTime } = state;
    let snapped = false;

    if (isUnregulated !== wasUnregulated || signChanged) {
        const snapSign = signChanged ? state.unregulatedSign : (isUnregulated ? stanceSign : state.unregulatedSign);
        tiltAngle = tiltSign * snapSign * MAX_TILT;
        if (isUnregulated) unregulatedTime = 0;
        snapped = true;
    }

    if (isUnregulated && !snapped) {
        unregulatedTime += deltaTime;
        const wave = (Math.sin(2 * Math.PI * 2 * unregulatedTime) + 1) / 2;
        const tiltLow = (MAX_TILT + 3 * UNREGULATED_TILT) / 4;
        tiltAngle = tiltSign * stanceSign * (tiltLow + wave * (UNREGULATED_TILT - tiltLow));
    } else if (!isUnregulated) {
        tiltAngle = tiltSign * regulatedTilt;
    }

    return { tiltAngle, unregulatedSign: stanceSign, unregulatedTime };
}
