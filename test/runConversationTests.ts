import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clamp,
    getTrustBand,
    stanceDescription,
    getEffectiveStance,
    nextPhases,
    getDialogue,
    addInterPartTrust,
    drawInitialStance,
    createState,
    tick,
    rollTupleIndex,
} from '../src/conversation/ifsConversationSim.js';
import { shamedDrinkerScenario } from '../src/conversation/ifsConversationData.js';

const defaultSetup = {
    selfTrustA: 0.5, selfTrustB: 0.5,
    stanceA: 0.6, stanceB: -0.4,
    flipOddsA: 0.05, flipOddsB: 0.1,
};

// ---- clamp ----

test('clamp: within range', () => {
    assert.equal(clamp(0.5), 0.5);
});

test('clamp: above hi', () => {
    assert.equal(clamp(1.5), 1);
});

test('clamp: below lo', () => {
    assert.equal(clamp(-1.5), -1);
});

test('clamp: custom bounds', () => {
    assert.equal(clamp(5, 0, 3), 3);
    assert.equal(clamp(-1, 0, 3), 0);
});

// ---- getTrustBand ----

test('getTrustBand: hostile below 0.3', () => {
    assert.equal(getTrustBand(0), 'hostile');
    assert.equal(getTrustBand(0.29), 'hostile');
});

test('getTrustBand: guarded 0.3–0.5', () => {
    assert.equal(getTrustBand(0.3), 'guarded');
    assert.equal(getTrustBand(0.49), 'guarded');
});

test('getTrustBand: opening 0.5–0.7', () => {
    assert.equal(getTrustBand(0.5), 'opening');
    assert.equal(getTrustBand(0.69), 'opening');
});

test('getTrustBand: collaborative 0.7+', () => {
    assert.equal(getTrustBand(0.7), 'collaborative');
    assert.equal(getTrustBand(1), 'collaborative');
});

// ---- stanceDescription ----

test('stanceDescription: flooding', () => {
    assert.equal(stanceDescription(0.61), 'flooding');
    assert.equal(stanceDescription(1), 'flooding');
});

test('stanceDescription: dysregulated', () => {
    assert.equal(stanceDescription(0.31), 'dysregulated');
    assert.equal(stanceDescription(0.6), 'dysregulated');
});

test('stanceDescription: regulated', () => {
    assert.equal(stanceDescription(0), 'regulated');
    assert.equal(stanceDescription(-0.29), 'regulated');
    assert.equal(stanceDescription(0.29), 'regulated');
});

test('stanceDescription: withdrawing', () => {
    assert.equal(stanceDescription(-0.31), 'withdrawing');
    assert.equal(stanceDescription(-0.59), 'withdrawing');
});

test('stanceDescription: shut down', () => {
    assert.equal(stanceDescription(-0.61), 'shut down');
    assert.equal(stanceDescription(-1), 'shut down');
});

// ---- getEffectiveStance ----

test('getEffectiveStance: adds delta and clamps', () => {
    assert.equal(getEffectiveStance(0.5, 0.3), 0.8);
    assert.equal(getEffectiveStance(0.9, 0.5), 1);
    assert.equal(getEffectiveStance(-0.9, -0.5), -1);
});

// ---- nextPhases ----

test('nextPhases: speak/listen → listen/mirror', () => {
    assert.deepEqual(nextPhases('speak', 'listen'), ['listen', 'mirror']);
});

test('nextPhases: listen/mirror → validate/listen (4-step)', () => {
    assert.deepEqual(nextPhases('listen', 'mirror', false), ['validate', 'listen']);
});

test('nextPhases: listen/mirror → clarify/listen (6-step)', () => {
    assert.deepEqual(nextPhases('listen', 'mirror', true), ['clarify', 'listen']);
});

test('nextPhases: clarify/listen → listen/mirror_again', () => {
    assert.deepEqual(nextPhases('clarify', 'listen'), ['listen', 'mirror_again']);
});

test('nextPhases: listen/mirror_again → validate/listen', () => {
    assert.deepEqual(nextPhases('listen', 'mirror_again'), ['validate', 'listen']);
});

test('nextPhases: validate/listen → listen/empathize', () => {
    assert.deepEqual(nextPhases('validate', 'listen'), ['listen', 'empathize']);
});

test('nextPhases: listen/empathize → listen/listen (cycle end)', () => {
    assert.deepEqual(nextPhases('listen', 'empathize'), ['listen', 'listen']);
});

test('nextPhases: invalid combo returns null', () => {
    assert.equal(nextPhases('speak', 'speak'), null);
    assert.equal(nextPhases('listen', 'listen'), null);
});

// ---- addInterPartTrust ----

test('addInterPartTrust: increases trust', () => {
    const rel = { trust: 0.3, trustFloor: 0, stance: 0, stanceMagnitude: 0, stanceFlipOdds: 0 };
    addInterPartTrust(rel, 0.2);
    assert.ok(Math.abs(rel.trust - 0.5) < 1e-9);
});

test('addInterPartTrust: clamps at 1', () => {
    const rel = { trust: 0.9, trustFloor: 0, stance: 0, stanceMagnitude: 0, stanceFlipOdds: 0 };
    addInterPartTrust(rel, 0.5);
    assert.equal(rel.trust, 1);
});

test('addInterPartTrust: clamps at trustFloor', () => {
    const rel = { trust: 0.4, trustFloor: 0.3, stance: 0, stanceMagnitude: 0, stanceFlipOdds: 0 };
    addInterPartTrust(rel, -0.5);
    assert.ok(rel.trust >= 0.3);
});

test('addInterPartTrust: negative delta halved above trustFloor', () => {
    const rel = { trust: 0.5, trustFloor: 0.2, stance: 0.5, stanceMagnitude: 0, stanceFlipOdds: 0 };
    addInterPartTrust(rel, -0.1);
    assert.ok(Math.abs(rel.trust - 0.45) < 1e-9);
});

// ---- drawInitialStance ----

test('drawInitialStance: sign matches magnitude sign (statistically)', () => {
    let positiveCount = 0;
    for (let i = 0; i < 200; i++) {
        if (drawInitialStance(0.8, 0, 0.5) > 0) positiveCount++;
    }
    assert.ok(positiveCount > 150, `Expected mostly positive, got ${positiveCount}/200`);
});

test('drawInitialStance: flipOdds=0.5 produces roughly half negative', () => {
    let negativeCount = 0;
    for (let i = 0; i < 500; i++) {
        if (drawInitialStance(0.8, 0.5, 0.5) < 0) negativeCount++;
    }
    assert.ok(negativeCount > 150 && negativeCount < 350, `Expected ~half negative, got ${negativeCount}/500`);
});

test('drawInitialStance: result is within [-1, 1]', () => {
    for (let i = 0; i < 100; i++) {
        const s = drawInitialStance(0.8, 0.1, 0.5);
        assert.ok(s >= -1 && s <= 1);
    }
});

// ---- getDialogue ----

test('getDialogue: returns null for listen phase', () => {
    const state = createState(defaultSetup, shamedDrinkerScenario);
    assert.equal(getDialogue(state.relAB, 'listen', state.conversation), null);
});

test('getDialogue: returns string for speak phase', () => {
    const state = createState(defaultSetup, shamedDrinkerScenario);
    rollTupleIndex(state.relAB, state.conversation);
    const line = getDialogue(state.relAB, 'speak', state.conversation);
    assert.ok(typeof line === 'string' && line.length > 0);
});

// ---- createState ----

test('createState: parts have correct selfTrust', () => {
    const state = createState(defaultSetup, shamedDrinkerScenario);
    assert.equal(state.partA.selfTrust, defaultSetup.selfTrustA);
    assert.equal(state.partB.selfTrust, defaultSetup.selfTrustB);
});

test('createState: conversation has initial effective stances', () => {
    const state = createState(defaultSetup, shamedDrinkerScenario);
    assert.ok(state.conversation.effectiveStances.has(state.partA.id));
    assert.ok(state.conversation.effectiveStances.has(state.partB.id));
});

test('createState: simTime starts at 0', () => {
    const state = createState(defaultSetup, shamedDrinkerScenario);
    assert.equal(state.simTime, 0);
});

// ---- tick ----

test('tick: advances simTime', () => {
    const state = createState(defaultSetup, shamedDrinkerScenario);
    tick(state, 0.1);
    assert.ok(Math.abs(state.simTime - 0.1) < 1e-9);
});

test('tick: returns array of SimEvents', () => {
    const state = createState(defaultSetup, shamedDrinkerScenario);
    const events = tick(state, 0.1);
    assert.ok(Array.isArray(events));
});

test('tick: eventually produces a message event', () => {
    const state = createState(defaultSetup, shamedDrinkerScenario);
    let found = false;
    for (let i = 0; i < 1000 && !found; i++) {
        const events = tick(state, 0.1);
        if (events.some(e => e.kind === 'message')) found = true;
    }
    assert.ok(found, 'Expected a message event within 100 sim-seconds');
});
