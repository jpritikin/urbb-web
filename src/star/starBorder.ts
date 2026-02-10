export interface StarArmPoints {
    tip: { x: number; y: number };
    base1: { x: number; y: number };
    base2: { x: number; y: number };
    innerRadius: number;
    baseTipAngle: number; // tip angle without pulse offset, for stable expansion direction
}

export interface BoundingBox {
    minX: number; maxX: number; minY: number; maxY: number;
}

export interface ConversationCloudInfo {
    boxes: BoundingBox[]; // bounding boxes in star-local coords (cloud shape, badge, etc.)
}

export interface ConversationVisualState {
    active: boolean;
    clouds: ConversationCloudInfo[] | null;
    tableCenter: Point | null; // conference table center in star-local coords
}

interface Point { x: number; y: number }

const MORPH_DURATION = 2.5; // seconds to fully activate/deactivate
const ENCLOSING_PADDING = 40;
const MAX_SEGMENT_LENGTH = 20;
const MAX_SUBDIVIDE_DEPTH = 7;
const DEBUG_KNOTS = false;

const WOBBLE_ARC_PX = 80; // arc length of the bulge in pixels

interface WobbleWave {
    phase: number;       // starting angle (radians)
    period: number;      // seconds per full 2π loop (negative = reverse direction)
    amplitude: number;   // positive = outward, negative = inward
}

const WOBBLE_WAVES: WobbleWave[] = [
    { phase: 0, period: 25, amplitude: 15 },
    { phase: 2.1, period: -21.7, amplitude: -20 },
    { phase: 1, period: 35, amplitude: 15 },
];

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function normalizeAngle(a: number): number {
    return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

function angleDiff(a: number, b: number): number {
    let d = normalizeAngle(b - a);
    if (d > Math.PI) d -= 2 * Math.PI;
    return d;
}

function fmt(p: Point): string {
    return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
}

function arcControlPoints(
    cx: number, cy: number, r: number, a1: number, a2: number
): { cp1: Point; cp2: Point } {
    const da = angleDiff(a1, a2);
    const alpha = (4 / 3) * Math.tan(da / 4);
    const cos1 = Math.cos(a1), sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2), sin2 = Math.sin(a2);
    return {
        cp1: { x: cx + r * (cos1 - alpha * sin1), y: cy + r * (sin1 + alpha * cos1) },
        cp2: { x: cx + r * (cos2 + alpha * sin2), y: cy + r * (sin2 - alpha * cos2) },
    };
}

function catmullRomCPs(
    p0: Point, p1: Point, p2: Point, p3: Point, alpha: number = 0.5
): { cp1: Point; cp2: Point } {
    const d01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const d23 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
    const t01 = Math.pow(d01, alpha);
    const t12 = Math.pow(d12, alpha);
    const t23 = Math.pow(d23, alpha);
    const safeD1 = (t01 + t12) < 0.001 ? 1 : (t01 + t12);
    const safeD2 = (t12 + t23) < 0.001 ? 1 : (t12 + t23);
    return {
        cp1: {
            x: p1.x + (p2.x - p0.x) * t12 / (3 * safeD1),
            y: p1.y + (p2.y - p0.y) * t12 / (3 * safeD1),
        },
        cp2: {
            x: p2.x - (p3.x - p1.x) * t12 / (3 * safeD2),
            y: p2.y - (p3.y - p1.y) * t12 / (3 * safeD2),
        },
    };
}

// A vertex in the densified ring. Structural vertices come from arm geometry;
// subdivided vertices are interpolated along the expanded contour.
interface RingVertex {
    point: Point;
    smoothing: number;       // 0 = sharp, 1 = fully smooth (Catmull-Rom)
    isStructural: boolean;   // true for original base1/tip/base2 vertices
    segType: number;         // 0: base1→tip edge, 1: tip→base2 edge, 2: inner arc
    starPoint: Point;        // position on the original star contour (for sharp CP computation)
    expansionAngle: number;  // stable angle for expansion (unaffected by pulse twist)
}

// Distance from star at which segments abruptly become fully smooth
const SMOOTH_DISTANCE_THRESHOLD = 20;

export class StarBorder {
    private pathElement: SVGPathElement;
    private debugGroup: SVGGElement | null = null;
    private centerX: number;
    private centerY: number;
    private expandDeepenOpacity: number = 1;
    private activationProgress: number = 0;
    private wobbleAngles: number[] = WOBBLE_WAVES.map(w => w.phase);
    private foreground: boolean = false;
    private armSegments: StarArmPoints[] = [];
    private lastClouds: ConversationCloudInfo[] | null = null;
    private lastTableCenter: Point | null = null;
    private lastArcAngles: Float64Array = new Float64Array(0); // per-vertex arc angle [0, 2π)

    constructor(centerX: number, centerY: number) {
        this.centerX = centerX;
        this.centerY = centerY;
        this.pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.pathElement.setAttribute('fill', 'none');
        this.pathElement.setAttribute('stroke', '#f400d7');
        this.pathElement.setAttribute('stroke-width', '1');
        this.pathElement.setAttribute('stroke-dasharray', '2,2');
    }

    getElement(): SVGPathElement {
        return this.pathElement;
    }

    setCenter(centerX: number, centerY: number): void {
        this.centerX = centerX;
        this.centerY = centerY;
    }

    setExpandDeepenOpacity(opacity: number): void {
        this.expandDeepenOpacity = opacity;
    }

    setForeground(fg: boolean): void {
        this.foreground = fg;
        if (!fg) {
            this.activationProgress = 0;
            this.lastClouds = null;
            this.lastTableCenter = null;
        }
    }

    updateStarGeometry(arms: StarArmPoints[]): void {
        this.armSegments = arms;
    }

    update(dt: number, conversation: ConversationVisualState): void {
        for (let i = 0; i < WOBBLE_WAVES.length; i++) {
            const omega = 2 * Math.PI / WOBBLE_WAVES[i].period;
            this.wobbleAngles[i] = ((this.wobbleAngles[i] + dt * omega) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        }
        const target = (this.foreground && conversation.active) ? 1 : 0;
        const k = 3 / MORPH_DURATION; // reaches ~95% at MORPH_DURATION seconds
        this.activationProgress += (target - this.activationProgress) * (1 - Math.exp(-k * dt));
        if (Math.abs(this.activationProgress - target) < 0.001) {
            this.activationProgress = target;
        }

        const effectiveOpacity = this.expandDeepenOpacity;
        this.pathElement.style.opacity = String(effectiveOpacity);

        const N = this.armSegments.length;
        if (N === 0) {
            this.pathElement.setAttribute('d', '');
            this.updateDebug([]);
            return;
        }

        const sorted = this.getSortedArms();
        const t = this.activationProgress;
        // Use live clouds when active, frozen last clouds when deflating
        const clouds = conversation.active ? conversation.clouds : this.lastClouds;
        const tableCenter = conversation.active ? conversation.tableCenter : this.lastTableCenter;
        const cloudDir = t > 0.001 ? this.computeCloudCentroidDir(clouds) : null;

        // Build the densified ring of vertices
        const ring = this.buildRing(sorted, t, cloudDir, clouds);

        // Snap to fully smooth for vertices displaced beyond threshold
        for (const rv of ring) {
            const dist = Math.hypot(rv.point.x - this.centerX, rv.point.y - this.centerY);
            const starDist = Math.hypot(rv.starPoint.x - this.centerX, rv.starPoint.y - this.centerY);
            if (dist - starDist > SMOOTH_DISTANCE_THRESHOLD) {
                rv.smoothing = 1;
            }
        }

        // Apply wobble: traveling cosine bulges along the border
        // Wobble orbits the conference table center, not the star center.
        const tc = tableCenter ?? { x: this.centerX, y: this.centerY };
        if (t > 0.01) {
            const n = ring.length;
            // Compute table-relative angle and outward direction per vertex
            if (this.lastArcAngles.length !== n) this.lastArcAngles = new Float64Array(n);
            const tableDir = new Float64Array(n * 2);
            for (let i = 0; i < n; i++) {
                const dx = ring[i].point.x - tc.x;
                const dy = ring[i].point.y - tc.y;
                const d = Math.hypot(dx, dy);
                this.lastArcAngles[i] = Math.atan2(dy, dx);
                tableDir[i * 2] = d > 0.01 ? dx / d : 0;
                tableDir[i * 2 + 1] = d > 0.01 ? dy / d : 0;
            }
            // Estimate avg radius from table center for bulge angular half-width
            const avgRadius = ring.reduce((sum, rv) =>
                sum + Math.hypot(rv.point.x - tc.x, rv.point.y - tc.y), 0) / n;
            const halfWidth = avgRadius > 1 ? (WOBBLE_ARC_PX / 2) / avgRadius : 0.5;

            for (let vi = 0; vi < n; vi++) {
                const rv = ring[vi];
                if (rv.smoothing < 0.01) continue;
                const tableAngle = this.lastArcAngles[vi];
                let wobble = 0;
                for (let i = 0; i < WOBBLE_WAVES.length; i++) {
                    const wave = WOBBLE_WAVES[i];
                    let delta = tableAngle - this.wobbleAngles[i];
                    delta -= Math.round(delta / (2 * Math.PI)) * 2 * Math.PI;
                    const x = delta / halfWidth;
                    if (x > -1 && x < 1) {
                        wobble += wave.amplitude * 0.5 * (1 + Math.cos(Math.PI * x));
                    }
                }
                wobble *= rv.smoothing;
                rv.point = {
                    x: rv.point.x + tableDir[vi * 2] * wobble,
                    y: rv.point.y + tableDir[vi * 2 + 1] * wobble,
                };
            }
        }

        if (conversation.active) {
            this.lastClouds = conversation.clouds;
            this.lastTableCenter = conversation.tableCenter;
        } else if (t < 0.001) {
            this.lastClouds = null;
            this.lastTableCenter = null;
        }
        this.pathElement.setAttribute('d', this.buildPath(ring));
        this.updateDebug(ring);
    }

    private stableAngle(point: Point): number {
        return Math.atan2(point.y - this.centerY, point.x - this.centerX);
    }

    // Build the vertex ring: structural vertices + subdivided extras on expanded segments
    private buildRing(
        sortedArms: StarArmPoints[],
        t: number,
        cloudDir: Point | null,
        clouds: ConversationCloudInfo[] | null,
    ): RingVertex[] {
        const N = sortedArms.length;
        const ring: RingVertex[] = [];

        for (let armIdx = 0; armIdx < N; armIdx++) {
            const arm = sortedArms[armIdx];
            const nextArm = sortedArms[(armIdx + 1) % N];

            // Stable angles: bases are un-twisted, tip uses baseTipAngle
            const structural: { point: Point; segType: number; angle: number }[] = [
                { point: arm.base1, segType: 0, angle: this.stableAngle(arm.base1) },
                { point: arm.tip, segType: 1, angle: arm.baseTipAngle },
                { point: arm.base2, segType: 2, angle: this.stableAngle(arm.base2) },
            ];

            for (let vi = 0; vi < 3; vi++) {
                const sp = structural[vi];
                const ef = cloudDir ? this.computeExpansionFactorAtAngle(sp.angle, cloudDir) : 0;
                const smoothing = ef * t;
                const expanded = this.expandPoint(sp.point, ef * t, sp.angle, clouds);

                ring.push({
                    point: expanded,
                    smoothing,
                    isStructural: true,
                    segType: sp.segType,
                    starPoint: sp.point,
                    expansionAngle: sp.angle,
                });

                const nextSPData = vi < 2
                    ? structural[vi + 1]
                    : { point: nextArm.base1, segType: 0, angle: this.stableAngle(nextArm.base1) };
                const nextEf = cloudDir ? this.computeExpansionFactorAtAngle(nextSPData.angle, cloudDir) : 0;
                const nextSmoothing = nextEf * t;
                const nextExpanded = this.expandPoint(nextSPData.point, nextEf * t, nextSPData.angle, clouds);

                // Adaptive subdivision: bisect until expanded gap <= MAX_SEGMENT_LENGTH
                this.subdivideSegment(
                    ring, expanded, sp.point, sp.angle, ef,
                    nextExpanded, nextSPData.point, nextSPData.angle, nextEf,
                    smoothing, nextSmoothing, t, sp.segType, clouds, 0,
                );
            }
        }

        // Insert boundary knots at the smooth/sharp transition so straight segments
        // don't get too long (important for 3-arm stars with few structural vertices)
        if (t > 0.01) {
            this.insertThresholdKnots(ring, clouds);
        }

        return ring;
    }

    private subdivideSegment(
        ring: RingVertex[],
        aExpanded: Point, aStar: Point, aAngle: number, aEf: number,
        bExpanded: Point, bStar: Point, bAngle: number, bEf: number,
        aSmoothing: number, bSmoothing: number,
        t: number, segType: number,
        clouds: ConversationCloudInfo[] | null, depth: number,
    ): void {
        if (depth >= MAX_SUBDIVIDE_DEPTH) return;
        // Only subdivide segments that are expanded beyond the star's outer radius
        const aDist = Math.hypot(aExpanded.x - this.centerX, aExpanded.y - this.centerY);
        const aStarDist = Math.hypot(aStar.x - this.centerX, aStar.y - this.centerY);
        const bDist = Math.hypot(bExpanded.x - this.centerX, bExpanded.y - this.centerY);
        const bStarDist = Math.hypot(bStar.x - this.centerX, bStar.y - this.centerY);
        if (aDist - aStarDist < SMOOTH_DISTANCE_THRESHOLD && bDist - bStarDist < SMOOTH_DISTANCE_THRESHOLD) return;
        const gap = Math.hypot(bExpanded.x - aExpanded.x, bExpanded.y - aExpanded.y);
        if (gap <= MAX_SEGMENT_LENGTH) return;

        const midStar = lerpPoint(aStar, bStar, 0.5);
        const midAngle = aAngle + angleDiff(aAngle, bAngle) * 0.5;
        const midEf = (aEf + bEf) * 0.5;
        const midSmoothing = (aSmoothing + bSmoothing) * 0.5;
        const midExpanded = this.expandPoint(midStar, midEf * t, midAngle, clouds);

        this.subdivideSegment(ring, aExpanded, aStar, aAngle, aEf, midExpanded, midStar, midAngle, midEf, aSmoothing, midSmoothing, t, segType, clouds, depth + 1);
        ring.push({
            point: midExpanded,
            smoothing: midSmoothing,
            isStructural: false,
            segType,
            starPoint: midStar,
            expansionAngle: midAngle,
        });
        this.subdivideSegment(ring, midExpanded, midStar, midAngle, midEf, bExpanded, bStar, bAngle, bEf, midSmoothing, bSmoothing, t, segType, clouds, depth + 1);
    }

    private insertThresholdKnots(ring: RingVertex[], clouds: ConversationCloudInfo[] | null): void {
        const displacement = (rv: RingVertex) => {
            const dist = Math.hypot(rv.point.x - this.centerX, rv.point.y - this.centerY);
            const starDist = Math.hypot(rv.starPoint.x - this.centerX, rv.starPoint.y - this.centerY);
            return dist - starDist;
        };

        for (let i = ring.length - 1; i >= 0; i--) {
            const curr = ring[i];
            const next = ring[(i + 1) % ring.length];
            const dCurr = displacement(curr);
            const dNext = displacement(next);
            const currOver = dCurr > SMOOTH_DISTANCE_THRESHOLD;
            const nextOver = dNext > SMOOTH_DISTANCE_THRESHOLD;
            if (currOver === nextOver) continue;

            // Interpolate to find where displacement crosses the threshold
            const frac = (SMOOTH_DISTANCE_THRESHOLD - dCurr) / (dNext - dCurr);
            if (frac <= 0.05 || frac >= 0.95) continue;
            const interpAngle = curr.expansionAngle + angleDiff(curr.expansionAngle, next.expansionAngle) * frac;
            const interpStar = lerpPoint(curr.starPoint, next.starPoint, frac);
            const interpSmoothing = lerp(curr.smoothing, next.smoothing, frac);
            const interpExpanded = this.expandPoint(interpStar, interpSmoothing, interpAngle, clouds);

            const boundaryVertex: RingVertex = {
                point: interpExpanded,
                smoothing: interpSmoothing,
                isStructural: false,
                segType: curr.segType,
                starPoint: interpStar,
                expansionAngle: interpAngle,
            };
            ring.splice(i + 1, 0, boundaryVertex);
        }
    }

    private expandPoint(
        starPoint: Point, ef: number, expansionAngle: number,
        clouds: ConversationCloudInfo[] | null,
    ): Point {
        if (ef < 0.001) return starPoint;
        const dx = starPoint.x - this.centerX;
        const dy = starPoint.y - this.centerY;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.01) return starPoint;
        const enclosingR = this.computeEnclosingRadius(expansionAngle, clouds);
        const expandedDist = lerp(dist, enclosingR, ef);
        const cosA = Math.cos(expansionAngle);
        const sinA = Math.sin(expansionAngle);
        return {
            x: this.centerX + cosA * expandedDist,
            y: this.centerY + sinA * expandedDist,
        };
    }

    private getSortedArms(): StarArmPoints[] {
        return [...this.armSegments].sort((a, b) => {
            const aAngle = normalizeAngle(Math.atan2(a.tip.y - this.centerY, a.tip.x - this.centerX));
            const bAngle = normalizeAngle(Math.atan2(b.tip.y - this.centerY, b.tip.x - this.centerX));
            return aAngle - bAngle;
        });
    }

    private computeCloudCentroidDir(clouds: ConversationCloudInfo[] | null): Point | null {
        if (!clouds || clouds.length === 0) return null;
        let cx = 0, cy = 0;
        let count = 0;
        for (const c of clouds) {
            for (const b of c.boxes) {
                const midX = (b.minX + b.maxX) / 2;
                const midY = (b.minY + b.maxY) / 2;
                cx += midX - this.centerX;
                cy += midY - this.centerY;
                count++;
            }
        }
        if (count === 0) return null;
        cx /= count;
        cy /= count;
        const d = Math.hypot(cx, cy);
        if (d < 0.01) return null;
        return { x: cx / d, y: cy / d };
    }

    private computeExpansionFactorAtAngle(angle: number, cloudDir: Point): number {
        const dot = Math.cos(angle) * cloudDir.x + Math.sin(angle) * cloudDir.y;
        return Math.max(0, (dot + 0.5) / 1.5);
    }

    private computeEnclosingRadius(angle: number, clouds: ConversationCloudInfo[] | null): number {
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const innerR = this.armSegments.length > 0 ? this.armSegments[0].innerRadius : 10;
        const wobbleMargin = Math.max(...WOBBLE_WAVES.map(w => w.amplitude), 0);
        let maxProjection = innerR + ENCLOSING_PADDING;
        if (clouds) {
            for (const cloud of clouds) {
                for (const b of cloud.boxes) {
                    // Project all 4 corners of the box
                    const corners = [
                        { x: b.minX - this.centerX, y: b.minY - this.centerY },
                        { x: b.maxX - this.centerX, y: b.minY - this.centerY },
                        { x: b.minX - this.centerX, y: b.maxY - this.centerY },
                        { x: b.maxX - this.centerX, y: b.maxY - this.centerY },
                    ];
                    for (const c of corners) {
                        const proj = c.x * cosA + c.y * sinA;
                        maxProjection = Math.max(maxProjection, proj + ENCLOSING_PADDING + wobbleMargin);
                    }
                }
            }
        }
        return maxProjection;
    }

    // Build the SVG path from the densified ring.
    // Each segment between consecutive ring vertices is a cubic bezier.
    // For low smoothing: sharp CPs (straight line or arc). For high smoothing: Catmull-Rom CPs.
    private buildPath(ring: RingVertex[]): string {
        const n = ring.length;
        if (n < 3) return '';

        const parts: string[] = [`M ${fmt(ring[0].point)}`];

        for (let i = 0; i < n; i++) {
            const curr = ring[i];
            const next = ring[(i + 1) % n];
            const start = curr.point;
            const end = next.point;
            const segSmoothing = Math.min(curr.smoothing, next.smoothing);

            // Sharp control points
            let sharpCP1: Point, sharpCP2: Point;

            if (curr.isStructural && next.isStructural && curr.segType === 2) {
                // Inner arc between base2 and next base1 (only when no subdivisions between them)
                const a1 = Math.atan2(curr.starPoint.y - this.centerY, curr.starPoint.x - this.centerX);
                const a2 = Math.atan2(next.starPoint.y - this.centerY, next.starPoint.x - this.centerX);
                const r1 = Math.hypot(start.x - this.centerX, start.y - this.centerY);
                const r2 = Math.hypot(end.x - this.centerX, end.y - this.centerY);
                if (r1 > 0.01) {
                    const baseArc = arcControlPoints(0, 0, 1, a1, a2);
                    sharpCP1 = {
                        x: this.centerX + baseArc.cp1.x * r1,
                        y: this.centerY + baseArc.cp1.y * r1,
                    };
                    sharpCP2 = {
                        x: this.centerX + baseArc.cp2.x * r2,
                        y: this.centerY + baseArc.cp2.y * r2,
                    };
                } else {
                    sharpCP1 = lerpPoint(start, end, 1 / 3);
                    sharpCP2 = lerpPoint(start, end, 2 / 3);
                }
            } else {
                // Straight line as cubic bezier
                sharpCP1 = lerpPoint(start, end, 1 / 3);
                sharpCP2 = lerpPoint(start, end, 2 / 3);
            }

            if (segSmoothing < 0.001) {
                parts.push(`C ${fmt(sharpCP1)} ${fmt(sharpCP2)} ${fmt(end)}`);
                continue;
            }

            // Smooth: Catmull-Rom from neighboring ring vertices
            const prev = ring[(i - 1 + n) % n].point;
            const nextNext = ring[(i + 2) % n].point;
            const smooth = catmullRomCPs(prev, start, end, nextNext);

            parts.push(`C ${fmt(lerpPoint(sharpCP1, smooth.cp1, segSmoothing))} ${fmt(lerpPoint(sharpCP2, smooth.cp2, segSmoothing))} ${fmt(end)}`);
        }

        parts.push('Z');
        return parts.join(' ');
    }

    private updateDebug(ring: RingVertex[]): void {
        if (!DEBUG_KNOTS) {
            if (this.debugGroup) {
                this.debugGroup.remove();
                this.debugGroup = null;
            }
            return;
        }

        const parent = this.pathElement.parentElement;
        const root = parent?.parentElement;
        if (!parent || !root) return;

        if (!this.debugGroup) {
            this.debugGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            this.debugGroup.setAttribute('class', 'star-border-debug');
        }
        // Append to root (uiGroup) so debug renders on top of clouds/carpets.
        // Copy the star wrapper's transform so coordinates stay correct.
        root.appendChild(this.debugGroup);
        const xform = parent.getAttribute('transform');
        if (xform) this.debugGroup.setAttribute('transform', xform);
        else this.debugGroup.removeAttribute('transform');

        const opacity = this.pathElement.style.opacity;

        // Count needed elements: knot circles + bounding box rects
        const boxes: BoundingBox[] = [];
        if (this.lastClouds) {
            for (const cloud of this.lastClouds) {
                for (const b of cloud.boxes) boxes.push(b);
            }
        }
        const totalElements = ring.length + WOBBLE_WAVES.length + boxes.length;

        while (this.debugGroup.children.length > totalElements) {
            this.debugGroup.lastChild?.remove();
        }

        // Knot circles
        for (let i = 0; i < ring.length; i++) {
            let circle = this.debugGroup.children[i] as SVGElement | undefined;
            if (!circle || circle.tagName !== 'circle') {
                circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('r', '1.5');
                circle.setAttribute('stroke', 'none');
                if (i < this.debugGroup.children.length) {
                    this.debugGroup.replaceChild(circle, this.debugGroup.children[i]);
                } else {
                    this.debugGroup.appendChild(circle);
                }
            }
            circle.setAttribute('cx', ring[i].point.x.toFixed(2));
            circle.setAttribute('cy', ring[i].point.y.toFixed(2));
            circle.setAttribute('fill', ring[i].isStructural ? '#ff0000' : '#00ff00');
            circle.style.opacity = opacity;
        }

        // Wobble peak markers: find ring vertex whose table-center angle matches the wave peak
        const tcDbg = this.lastTableCenter ?? { x: this.centerX, y: this.centerY };
        const WAVE_COLORS = ['#ffff00', '#00ffff', '#ff8800', '#88ff00'];
        for (let wi = 0; wi < WOBBLE_WAVES.length; wi++) {
            const idx = ring.length + wi;
            const peakAngle = this.wobbleAngles[wi];

            let bestIdx = 0;
            let bestDelta = Infinity;
            for (let ri = 0; ri < ring.length; ri++) {
                if (ri >= this.lastArcAngles.length) break;
                const d = Math.abs(angleDiff(this.lastArcAngles[ri], peakAngle));
                if (d < bestDelta) { bestDelta = d; bestIdx = ri; }
            }
            const nearest = ring[bestIdx];
            const dx = nearest.point.x - tcDbg.x;
            const dy = nearest.point.y - tcDbg.y;
            const dist = Math.hypot(dx, dy);
            const nx = dist > 0.01 ? dx / dist : 0;
            const ny = dist > 0.01 ? dy / dist : 0;
            const mx = nearest.point.x + nx * 8;
            const my = nearest.point.y + ny * 8;

            let marker = this.debugGroup.children[idx] as SVGElement | undefined;
            if (!marker || marker.tagName !== 'polygon') {
                marker = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                if (idx < this.debugGroup.children.length) {
                    this.debugGroup.replaceChild(marker, this.debugGroup.children[idx]);
                } else {
                    this.debugGroup.appendChild(marker);
                }
            }
            const s = 4;
            marker.setAttribute('points',
                `${mx},${my - s} ${mx + s},${my} ${mx},${my + s} ${mx - s},${my}`);
            marker.setAttribute('fill', WAVE_COLORS[wi % WAVE_COLORS.length]);
            marker.setAttribute('stroke', '#000');
            marker.setAttribute('stroke-width', '0.5');
            marker.style.opacity = opacity;
        }

        // Bounding box rects
        for (let i = 0; i < boxes.length; i++) {
            const idx = ring.length + WOBBLE_WAVES.length + i;
            let rect = this.debugGroup.children[idx] as SVGElement | undefined;
            if (!rect || rect.tagName !== 'rect') {
                rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('fill', 'none');
                rect.setAttribute('stroke-width', '0.5');
                rect.setAttribute('stroke-dasharray', '2,1');
                if (idx < this.debugGroup.children.length) {
                    this.debugGroup.replaceChild(rect, this.debugGroup.children[idx]);
                } else {
                    this.debugGroup.appendChild(rect);
                }
            }
            const b = boxes[i];
            rect.setAttribute('x', b.minX.toFixed(2));
            rect.setAttribute('y', b.minY.toFixed(2));
            rect.setAttribute('width', (b.maxX - b.minX).toFixed(2));
            rect.setAttribute('height', (b.maxY - b.minY).toFixed(2));
            rect.setAttribute('stroke', '#000066');
            rect.style.opacity = opacity;
        }
    }
}
