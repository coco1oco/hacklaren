import type { SummaryProvider } from '../../shared/contracts';
import { MockSummaryProvider } from './mockProvider';

/**
 * Selects the SummaryProvider from AI_PROVIDER. Only "mock" exists today; the Amazon Q provider will be
 * added later behind the same interface. Unknown values throw at call time (clear config error).
 */
export function getSummaryProvider(configured: string | undefined = process.env.AI_PROVIDER): SummaryProvider {
  const name = (configured ?? 'mock').trim().toLowerCase() || 'mock';
  if (name === 'mock') return new MockSummaryProvider();
  throw new Error(`Unsupported AI_PROVIDER "${name}". Only "mock" is available.`);
}
