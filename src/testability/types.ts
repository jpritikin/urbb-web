import type { BlendReason, BlendedPartState, PartMessage, SelfRayState, ThoughtBubble } from '../ifsModel.js';
import type { PartState, PartBiography, PartDialogues } from '../partState.js';

export interface SerializedModel {
    targetCloudIds: string[];
    supportingParts: Record<string, string[]>;
    blendedParts: Record<string, BlendedPartState>;
    pendingBlends: { cloudId: string; reason: BlendReason }[];
    selfRay: SelfRayState | null;
    displacedParts: string[];
    pendingAttentionDemand: string | null;
    messages: PartMessage[];
    messageIdCounter: number;
    partStates: Record<string, PartState>;
    thoughtBubbles?: ThoughtBubble[];
    victoryAchieved?: boolean;
}

export interface SerializedRelationships {
    protections: { protectorId: string; protectedId: string }[];
    grievances: { cloudId: string; targetIds: string[]; dialogues: string[] }[];
    proxies: { cloudId: string; proxyId: string }[];
}

export interface OrchestratorSnapshot {
    blendTimers: Record<string, number>;
    cooldowns: Record<string, number>;
    pending: Record<string, string>;
}

export interface ModelSnapshot {
    targets: string[];
    blended: string[];
}

export interface RecordedAction {
    action: string;
    cloudId: string;
    targetCloudId?: string;
    field?: string;
    elapsedTime?: number;  // Seconds since last action (for time-based state changes)
    thoughtBubble?: { text: string; cloudId: string };
    rngCounts?: { model: number; cosmetic: number };
    rngLog?: string[];  // Model RNG call purposes for this action
    orchState?: OrchestratorSnapshot;  // Orchestrator state before action
    modelState?: ModelSnapshot;  // Model state before action
}

export interface RecordedSession {
    version: 1;
    codeVersion: string;
    platform: 'desktop' | 'mobile';
    modelSeed: number;
    timestamp: number;
    initialModel: SerializedModel;
    initialRelationships: SerializedRelationships;
    actions: RecordedAction[];
    finalModel?: SerializedModel;
    finalRelationships?: SerializedRelationships;
}

export interface PartConfig {
    id: string;
    name: string;
    trust?: number;
    needAttention?: number;
    partAge?: number | string;
    dialogues?: PartDialogues;
}

export interface RelationshipConfig {
    protections?: { protectorId: string; protectedId: string | string[] }[];
    grievances?: { cloudId: string; targetIds: string | string[]; dialogues: string | string[] }[];
    proxies?: { cloudId: string; proxyId: string | string[] }[];
}

export interface Scenario {
    name: string;
    description?: string;
    seed?: number;
    parts: PartConfig[];
    relationships: RelationshipConfig;
    initialTargets?: string[];
    initialBlended?: { cloudId: string; reason: BlendReason; degree?: number }[];
    actions: { action: string; cloudId: string; targetCloudId?: string; field?: string }[];
    assertions?: Assertion[];
}

export interface Assertion {
    type: 'trust' | 'blended' | 'target' | 'message' | 'biography' | 'victory';
    cloudId?: string;
    field?: string;
    expected: unknown;
    operator?: '==' | '>=' | '<=' | 'contains' | '!=';
}

export interface ActionResult {
    success: boolean;
    message?: string;
    stateChanges?: string[];
}

export interface UIFeedback {
    thoughtBubble?: { text: string; cloudId: string };
    actionLabel?: string;
}

export interface ControllerActionResult {
    success: boolean;
    message?: string;
    stateChanges: string[];
    uiFeedback?: UIFeedback;
    triggerBacklash?: { protectorId: string; protecteeId: string };
    createSelfRay?: { cloudId: string };
    reduceBlending?: { cloudId: string; amount: number };
    trustGain?: number;
}

export interface ScenarioResult {
    passed: boolean;
    failedAssertions: { assertion: Assertion; actual: unknown }[];
    finalModel: SerializedModel;
    actionResults: ActionResult[];
}

export interface IterationResult {
    seed: number;
    metrics: Record<string, number | string | boolean>;
    finalModel: SerializedModel;
    error?: string;
}

export interface Distribution {
    min: number;
    max: number;
    mean: number;
    median: number;
    stdDev: number;
    histogram: { bucket: string; count: number }[];
}

export interface MonteCarloResults {
    iterations: number;
    distributions: Record<string, Distribution>;
    edgeCases: IterationResult[];
    timing: { totalMs: number; avgPerIteration: number };
}

export interface MetricDefinition {
    name: string;
    extract: (model: SerializedModel) => number | string | boolean;
}

export interface MonteCarloConfig {
    scenario: Scenario;
    iterations: number;
    metrics: MetricDefinition[];
    stopOnError?: boolean;
}
