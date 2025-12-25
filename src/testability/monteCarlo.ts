import { HeadlessSimulator } from './headlessSimulator.js';
import type {
    Scenario, MonteCarloConfig, MonteCarloResults,
    IterationResult, Distribution, MetricDefinition, SerializedModel
} from './types.js';

export class MonteCarloRunner {
    run(config: MonteCarloConfig): MonteCarloResults {
        const results: IterationResult[] = [];
        const startTime = performance.now();

        for (let i = 0; i < config.iterations; i++) {
            const seed = Date.now() + i * 1000 + Math.floor(Math.random() * 1000);
            const result = this.runIteration(config.scenario, seed, config.metrics);
            results.push(result);

            if (config.stopOnError && result.error) {
                break;
            }
        }

        const totalMs = performance.now() - startTime;

        return {
            iterations: results.length,
            distributions: this.computeDistributions(results, config.metrics),
            edgeCases: this.findEdgeCases(results),
            timing: {
                totalMs,
                avgPerIteration: totalMs / results.length,
            },
        };
    }

    private runIteration(
        scenario: Scenario,
        seed: number,
        metrics: MetricDefinition[]
    ): IterationResult {
        const sim = new HeadlessSimulator({ seed });

        try {
            sim.setupFromScenario(scenario);

            for (const action of scenario.actions) {
                sim.executeAction(action.action, action.cloudId, action.targetCloudId);
            }

            const finalModel = sim.getModelJSON();
            const extractedMetrics: Record<string, number | string | boolean> = {};

            for (const metric of metrics) {
                extractedMetrics[metric.name] = metric.extract(finalModel);
            }

            return {
                seed,
                metrics: extractedMetrics,
                finalModel,
            };
        } catch (e) {
            return {
                seed,
                metrics: {},
                finalModel: sim.getModelJSON(),
                error: String(e),
            };
        }
    }

    private computeDistributions(
        results: IterationResult[],
        metrics: MetricDefinition[]
    ): Record<string, Distribution> {
        const distributions: Record<string, Distribution> = {};

        for (const metric of metrics) {
            const values = results
                .map(r => r.metrics[metric.name])
                .filter((v): v is number => typeof v === 'number');

            if (values.length === 0) {
                // Handle boolean metrics
                const boolValues = results
                    .map(r => r.metrics[metric.name])
                    .filter((v): v is boolean => typeof v === 'boolean');

                if (boolValues.length > 0) {
                    const trueCount = boolValues.filter(v => v).length;
                    const rate = trueCount / boolValues.length;
                    distributions[metric.name] = {
                        min: 0,
                        max: 1,
                        mean: rate,
                        median: rate > 0.5 ? 1 : 0,
                        stdDev: Math.sqrt(rate * (1 - rate)),
                        histogram: [
                            { bucket: 'false', count: boolValues.length - trueCount },
                            { bucket: 'true', count: trueCount },
                        ],
                    };
                }
                continue;
            }

            values.sort((a, b) => a - b);

            const sum = values.reduce((a, b) => a + b, 0);
            const mean = sum / values.length;
            const median = values[Math.floor(values.length / 2)];
            const min = values[0];
            const max = values[values.length - 1];

            const squaredDiffs = values.map(v => (v - mean) ** 2);
            const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
            const stdDev = Math.sqrt(variance);

            const histogram = this.computeHistogram(values, 10);

            distributions[metric.name] = { min, max, mean, median, stdDev, histogram };
        }

        return distributions;
    }

    private computeHistogram(
        values: number[],
        bucketCount: number
    ): { bucket: string; count: number }[] {
        if (values.length === 0) return [];

        const min = values[0];
        const max = values[values.length - 1];
        const range = max - min || 1;
        const bucketSize = range / bucketCount;

        const buckets: number[] = new Array(bucketCount).fill(0);

        for (const value of values) {
            const idx = Math.min(
                Math.floor((value - min) / bucketSize),
                bucketCount - 1
            );
            buckets[idx]++;
        }

        return buckets.map((count, i) => ({
            bucket: `${(min + i * bucketSize).toFixed(2)}-${(min + (i + 1) * bucketSize).toFixed(2)}`,
            count,
        }));
    }

    private findEdgeCases(results: IterationResult[]): IterationResult[] {
        const edgeCases: IterationResult[] = [];

        // Include all errors
        for (const result of results) {
            if (result.error) {
                edgeCases.push(result);
            }
        }

        // Include extreme values for each numeric metric
        const numericMetrics = new Set<string>();
        for (const result of results) {
            for (const [key, value] of Object.entries(result.metrics)) {
                if (typeof value === 'number') {
                    numericMetrics.add(key);
                }
            }
        }

        for (const metricName of numericMetrics) {
            const sorted = [...results]
                .filter(r => typeof r.metrics[metricName] === 'number')
                .sort((a, b) =>
                    (a.metrics[metricName] as number) - (b.metrics[metricName] as number)
                );

            if (sorted.length >= 2) {
                // Add min and max if not already included
                if (!edgeCases.includes(sorted[0])) {
                    edgeCases.push(sorted[0]);
                }
                if (!edgeCases.includes(sorted[sorted.length - 1])) {
                    edgeCases.push(sorted[sorted.length - 1]);
                }
            }
        }

        return edgeCases.slice(0, 20); // Limit to 20 edge cases
    }
}

export function formatMonteCarloResults(results: MonteCarloResults): string {
    const lines: string[] = [];

    lines.push(`Monte Carlo Results (${results.iterations} iterations)`);
    lines.push(`Total time: ${results.timing.totalMs.toFixed(0)}ms (${results.timing.avgPerIteration.toFixed(2)}ms/iter)`);
    lines.push('');

    lines.push('Distributions:');
    for (const [name, dist] of Object.entries(results.distributions)) {
        lines.push(`  ${name}:`);
        lines.push(`    mean=${dist.mean.toFixed(3)}, median=${dist.median.toFixed(3)}, stdDev=${dist.stdDev.toFixed(3)}`);
        lines.push(`    range=[${dist.min.toFixed(3)}, ${dist.max.toFixed(3)}]`);
    }
    lines.push('');

    if (results.edgeCases.length > 0) {
        lines.push(`Edge cases (${results.edgeCases.length}):`);
        for (const edge of results.edgeCases.slice(0, 5)) {
            if (edge.error) {
                lines.push(`  [ERROR] seed=${edge.seed}: ${edge.error}`);
            } else {
                const metricStr = Object.entries(edge.metrics)
                    .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(3) : v}`)
                    .join(', ');
                lines.push(`  seed=${edge.seed}: ${metricStr}`);
            }
        }
    }

    return lines.join('\n');
}
