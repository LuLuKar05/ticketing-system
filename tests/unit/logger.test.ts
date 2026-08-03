import { runWithContext } from '../../src/observability/requestContext';
import { correlationMixin } from '../../src/observability/logger';

describe('logger correlation mixin', () => {
    it('adds no correlation_id outside a request context', () => {
        expect(correlationMixin()).toEqual({});
    });

    it('injects the correlation_id when inside a request context', () => {
        let captured: Record<string, string> = {};
        runWithContext({ correlationId: 'abc-123' }, () => {
            captured = correlationMixin();
        });
        expect(captured).toEqual({ correlation_id: 'abc-123' });
    });
});
