import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { getAudienceDescription, type AudienceType } from './composeAudience'

void test('getAudienceDescription covers all compose audience modes', () => {
  const expectations: Record<AudienceType, string> = {
    foaf: 'Close Ties (Your FOAF Network)',
    verified: 'Verified Humans in your Grid',
    'trust-circle': 'Trust Circle Members',
    local: 'Everyone in your Local H3 Grid',
  }

  for (const [audience, label] of Object.entries(expectations)) {
    assert.equal(getAudienceDescription(audience as AudienceType), label)
  }
})
