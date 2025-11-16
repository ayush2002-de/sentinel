// /api/src/services/agents/KBAgent.ts
import { prisma } from '../../lib/prisma.js';

export interface KBHit {
  docId: string;
  title: string;
  anchor: string;
  extract: string;
}

export class KBAgent {
  public static async search(q: string): Promise<KBHit[]> {
    const results = await prisma.kbDoc.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { content_text: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 3,
    });
    
    return results.map((r) => ({
      docId: r.id,
      title: r.title,
      anchor: r.anchor,
      extract: r.content_text.substring(0, 150) + '...',
    }));
  }
}

// /api/src/services/agents/InsightsAgent.ts
// ... (Logic from GET /api/insights/:customerId/summary)