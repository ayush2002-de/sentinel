// /api/src/services/SseService.ts
import { Request, Response } from 'express';
import { redis, redisSubscriber } from '../lib/redis.js';
import { RedactorAgent } from './agents/RedactorAgent.js';

class SseService {
  private getChannel(runId: string) {
    return `triage:${runId}`;
  }

  /**
   * Called by the API route to handle a client's SSE connection.
   * Returns a Promise that resolves when the Redis subscription is confirmed.
   */
  public async handleSse(req: Request, res: Response, runId: string): Promise<void> {
    const channel = this.getChannel(runId);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
    });

    // Send an initial "connected" event
    res.write(`event: plan_built\ndata: ${JSON.stringify({ message: 'Triage run started...' })}\n\n`);

    // Message listener - SET THIS UP FIRST before subscribing!
    const onMessage = (msgChannel: string, message: string) => {
      if (msgChannel === channel) {
        // message is a stringified { event, data } object
        const { event, data } = JSON.parse(message);
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    redisSubscriber.on('message', onMessage);

    // Subscribe to the Redis channel for this run AFTER setting up the listener
    // WAIT for subscription to be confirmed before returning
    try {
      await redisSubscriber.subscribe(channel);
      req.log.info(`SSE client subscribed to ${channel}`);
    } catch (err) {
      console.error(`Failed to subscribe to ${channel}`, err);
      res.end();
      throw err;
    }

    // Handle client disconnect
    req.on('close', () => {
      req.log.info(`SSE client disconnected from ${channel}`);
      redisSubscriber.off('message', onMessage);
      redisSubscriber.unsubscribe(channel);
      res.end();
    });
  }

  /**
   * Called by the Orchestrator to broadcast an event.
   */
  public async dispatch(runId: string, event: string, data: any) {
    const channel = this.getChannel(runId);
    // CRITICAL: Redact all data before sending to any external system
    const safeData = RedactorAgent.redactObject(data);
    const message = JSON.stringify({ event, data: safeData });

    // Publish to Redis
    try {
      await redis.publish(channel, message);
    } catch (error) {
      console.error(`Failed to publish SSE event to ${channel}:`, error);
    }
  }
}

// Export a singleton instance
export const sseService = new SseService();