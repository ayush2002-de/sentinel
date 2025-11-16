// /api/src/services/MetricsService.ts
import { Registry, Histogram, Counter, collectDefaultMetrics } from 'prom-client';

class MetricsService {
  public registry: Registry;

  // --- Histograms (Latency) ---
  public apiRequestLatency: Histogram<string>;
  public agentLatency: Histogram<string>;

  // --- Counters (Totals) ---
  public toolCallTotal: Counter<string>;
  public agentFallbackTotal: Counter<string>;
  public rateLimitBlockTotal: Counter<string>;
  public actionBlockedTotal: Counter<string>;

  constructor() {
    this.registry = new Registry();
    this.registry.setContentType(this.registry.contentType);
    
    // Enable default Node.js metrics (CPU, memory)
    collectDefaultMetrics({ register: this.registry });

    // --- Define Metrics ---

    this.apiRequestLatency = new Histogram({
      name: 'api_request_latency_ms',
      help: 'API request latency in milliseconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [50, 100, 200, 500, 1000, 2500, 5000], // ms
    });

    this.agentLatency = new Histogram({
      name: 'agent_latency_ms',
      help: 'Latency for a single agent/tool call',
      labelNames: ['step_name'],
    });

    this.toolCallTotal = new Counter({
      name: 'tool_call_total',
      help: 'Total number of agent/tool calls',
      labelNames: ['step_name', 'ok'], // ok = 'true' or 'false'
    });

    this.agentFallbackTotal = new Counter({
      name: 'agent_fallback_total',
      help: 'Total times an agent fallback was used',
      labelNames: ['step_name'],
    });

    this.rateLimitBlockTotal = new Counter({
      name: 'rate_limit_block_total',
      help: 'Total requests blocked by rate limiter',
    });
    
    this.actionBlockedTotal = new Counter({
      name: 'action_blocked_total',
      help: 'Total actions blocked by a policy (e.g., OTP)',
      labelNames: ['policy'],
    });

    // --- Register Metrics ---
    this.registry.registerMetric(this.apiRequestLatency);
    this.registry.registerMetric(this.agentLatency);
    this.registry.registerMetric(this.toolCallTotal);
    this.registry.registerMetric(this.agentFallbackTotal);
    this.registry.registerMetric(this.rateLimitBlockTotal);
    this.registry.registerMetric(this.actionBlockedTotal);
  }

  /**
   * Get the metrics string for the /metrics endpoint
   */
  public async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}

// Export a singleton instance
export const metrics = new MetricsService();