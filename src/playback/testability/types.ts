import type { BlendReason, BlendedPartState, PartMessage, SelfRayState, ThoughtBubble } from '../../simulator/ifsModel.js';
import type { PartState, PartBiography, PartDialogues } from '../../star/partState.js';
import type { ConversationDialogues } from '../../cloud/partStateManager.js';
import type { RngLogEntry } from './rng.js';
import type { AttentionDemandEntry } from '../../simulator/timeAdvancer.js';

export const WAIT_DURATION = 2.0;

export interface SerializedModel {
    targetCloudIds: string[];
    supportingParts: Record<string, string[]>;
    blendedParts: Record<string, BlendedPartState>;
    pendingBlends: { cloudId: string; reason: BlendReason; timer?: number }[];
    selfRay: SelfRayState | null;
    displacedParts: string[];
    messages: PartMessage[];
    messageIdCounter: number;
    partStates: Record<string, PartState>;
    protections: { protectorId: string; protectedId: string }[];
    interPartRelations: {
        fromId: string;
        toId: string;
        trust: number;
        trustFloor?: number;
        stance: number;
        stanceFlipOdds: number;
        stanceFlipOddsSetPoint?: number;
        dialogues?: ConversationDialogues;
        rumination?: string[];
        impactRecognition?: string[];
        impactRejection?: string[];
    }[];
    proxies: { cloudId: string; proxyId: string }[];
    thoughtBubbles?: ThoughtBubble[];
    victoryAchieved?: boolean;
    selfAmplification?: number;
    mode?: 'panorama' | 'foreground';
    pendingAction?: { actionId: string; sourceCloudId: string } | null;
    conversationEffectiveStances?: Record<string, number>;
    conversationTherapistDelta?: Record<string, number>;
    conversationParticipantIds?: [string, string] | null;
    conversationPhases?: Record<string, string>;
    conversationSpeakerId?: string | null;
    simulationTime?: number;
    orchestratorState?: OrchestratorSnapshot;
}

export interface OrchestratorSnapshot {
    blendTimers: Record<string, number>;
    cooldowns: Record<string, number>;
    pending: Record<string, string>;
    respondTimer?: number;
    regulationScore?: number;
    sustainedRegulationTimer?: number;
    newCycleTimer?: number;
    listenerViolationTimer?: number;
    selfLoathingCooldowns?: Record<string, number>;
    genericDialogueCooldowns?: Record<string, number>;
}

export interface BiographySnapshot {
    ageRevealed: boolean;
    identityRevealed: boolean;
    jobRevealed: boolean;
    jobAppraisalRevealed: boolean;
}

export interface ViewSnapshot {
    seats: string[];
    carpets: Record<string, { entering: boolean; exiting: boolean; landingProgress: number }>;
    conversationParticipantIds: [string, string] | null;
    transitionDirection: 'forward' | 'reverse' | 'none';
    transitionProgress: number;
}

export interface ModelSnapshot {
    targets: string[];
    blended: string[];
    pendingBlends?: string[];
    selfRay: { targetCloudId: string } | null;
    pendingAction?: { actionId: string; sourceCloudId: string } | null;
    biography?: Record<string, BiographySnapshot>;
    needAttention?: Record<string, number>;
    trust?: Record<string, number>;
    conversationEffectiveStances?: Record<string, number>;
    conversationPhases?: Record<string, string>;
    conversationTherapistDelta?: Record<string, number>;
    conversationSpeakerId?: string | null;
    interPartRelations?: { fromId: string; toId: string; stance: number; trust: number }[];
    thoughtBubbles?: { id: number; cloudId: string; text: string; validated?: boolean; partInitiated?: boolean }[];
    viewState?: ViewSnapshot;
}

export interface RecordedAction {
    action: string;
    cloudId: string;
    targetCloudId?: string;
    field?: string;
    newMode?: 'panorama' | 'foreground';  // For mode_change action: the mode being switched to
    elapsedTime?: number;  // Wall-clock seconds since last action
    effectiveTime?: number;  // Seconds of actual time advancement (excluding transitions)
    cumulativeTime?: number;  // Total seconds since session start (for drift diagnosis)
    preActionTime?: number;  // For spontaneous_blend: time before the blend (doesn't affect new part's timer)
    triggerRngCount?: number;  // For spontaneous_blend: RNG count when callback triggered
    triggerLastAttentionCheck?: number;  // For spontaneous_blend: lastAttentionCheck when callback triggered
    waitCount?: number;  // Number of WAIT_DURATION chunks to advance (for proper orchestrator timing)
    count?: number;  // For process_intervals action: number of 0.5s intervals to process
    stanceDelta?: number;
    thoughtBubble?: { text: string; cloudId: string };
    rngCounts?: { model: number };
    rngLog?: RngLogEntry[];  // Model RNG calls with labels and values
    attentionDemands?: AttentionDemandEntry[];  // Attention demands found during intervals
    needAttention?: Record<string, number>;  // Per-part needAttention after intervals
    isTransitioning?: boolean;  // Whether view was transitioning when recorded
    orchState?: OrchestratorSnapshot;  // Orchestrator state after action
    modelState?: ModelSnapshot;  // Model state after action
}

export interface RecordedSession {
    version: 1;
    codeVersion: string;
    platform: 'desktop' | 'mobile';
    modelSeed: number;
    timestamp: number;
    initialModel: SerializedModel;
    actions: RecordedAction[];
    finalModel?: SerializedModel;
}

export interface PartConfig {
    id: string;
    name: string;
    trust?: number;
    needAttention?: number;
    partAge?: number | string;
    dialogues?: PartDialogues;
}

export interface InterPartRelationConfig {
    fromId: string;
    toId: string;
    trust: number;
    stance: number;
    stanceFlipOdds: number;
    stanceFlipOddsSetPoint?: number;
    dialogues?: ConversationDialogues;
    rumination?: string[];
    impactRecognition?: string[];
    impactRejection?: string[];
}

export interface RelationshipConfig {
    protections?: { protectorId: string; protectedId: string | string[] }[];
    interPartRelations?: InterPartRelationConfig[];
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
    triggerBacklash?: { protectorId: string; protecteeId: string; extras: string[] };
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

export interface ActionGeneratorConfig {
    maxActions: number;
    allowedActions?: string[];  // If undefined, all actions are allowed
}

export interface CoverageEntry {
    count: number;
    seeds: number[];  // First N seeds that hit this
}

export interface CoverageData {
    actions: Record<string, CoverageEntry>;
    actionCloudPairs: Record<string, CoverageEntry>;  // "action:cloudId"
    transitions: Record<string, CoverageEntry>;  // "fromState->toState"
    rayFields: Record<string, CoverageEntry>;  // Biography fields accessed
    stateVisits: Record<string, CoverageEntry>;  // Serialized state snapshots
}

export interface RandomWalkConfig {
    iterations: number;
    maxActionsPerIteration: number;
    allowedActions?: string[];
    stopOnVictory?: boolean;
    stopOnError?: boolean;
    coverageTracking?: boolean;
    heuristicScoring?: boolean;
    extractPaths?: boolean;
    recordHeuristicState?: boolean;
    seed?: number;  // Fixed seed for reproducibility (only used when iterations=1)
}

export interface HeuristicState {
    phase: string;
    protectorId: string | null;
    protecteeId: string | null;
}

export interface RecordedWalkAction {
    action: string;
    cloudId: string;
    targetCloudId?: string;
    field?: string;
    stanceDelta?: number;
    heuristic?: HeuristicState;
    score?: number;
}

export interface RandomWalkResult {
    seed: number;
    actions: RecordedWalkAction[];
    finalModel: SerializedModel;
    victory: boolean;
    error?: string;
}

export interface WalkPath {
    seed: number;
    actions: { action: string; cloudId: string; targetCloudId?: string; field?: string }[];
    length: number;
    finalScore: number;
    victory: boolean;
}

export interface CoverageGap {
    type: 'action_never_valid' | 'action_never_picked' | 'precondition_never_met';
    action: string;
    reason: string;
    suggestion?: string;
}

export interface RandomWalkResults {
    iterations: number;
    completedIterations: number;
    victories: number;
    errors: RandomWalkResult[];
    coverage?: CoverageData;
    coverageGaps?: CoverageGap[];
    paths?: WalkPath[];
    bestScore?: number;
    timing: { totalMs: number; avgPerIteration: number };
}
