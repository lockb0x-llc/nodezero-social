import {
  validateDataBackpackProfile,
  validatePublicProfileDocument,
  validatePrivateProfilePreferencesDocument,
  validateConnectionRecord,
  validateStreamItem,
  assertValidDataBackpackProfile,
  assertValidPublicProfileDocument,
  assertValidPrivateProfilePreferencesDocument,
  assertValidConnectionRecord,
  assertValidStreamItem,
} from '../index.js'
import {
  validDataBackpackFixtures,
  invalidDataBackpackFixtures,
} from '../contracts/fixtures/dataBackpackFixtures.js'
import {
  validSocialGraphFixtures,
  invalidSocialGraphFixtures,
} from '../contracts/fixtures/socialGraphFixtures.js'
import {
  validDocustreamFixtures,
  invalidDocustreamFixtures,
} from '../contracts/fixtures/docustreamFixtures.js'

describe('Data Backpack contract conformance', () => {
  it('accepts valid fixtures', () => {
    for (const fixture of validDataBackpackFixtures) {
      expect(
        validatePublicProfileDocument({
          displayName: fixture.displayName,
          bio: fixture.bio,
          ...(fixture.avatarUrl ? { avatarUrl: fixture.avatarUrl } : {}),
          ...(fixture.externalUrl ? { externalUrl: fixture.externalUrl } : {}),
        })
      ).toEqual([])
      expect(
        validatePrivateProfilePreferencesDocument({
          interests: fixture.interests,
          isNsfw: fixture.isNsfw,
        })
      ).toEqual([])
      expect(validateDataBackpackProfile(fixture)).toEqual([])
      expect(() =>
        assertValidPublicProfileDocument({
          displayName: fixture.displayName,
          bio: fixture.bio,
          ...(fixture.avatarUrl ? { avatarUrl: fixture.avatarUrl } : {}),
          ...(fixture.externalUrl ? { externalUrl: fixture.externalUrl } : {}),
        })
      ).not.toThrow()
      expect(() =>
        assertValidPrivateProfilePreferencesDocument({
          interests: fixture.interests,
          isNsfw: fixture.isNsfw,
        })
      ).not.toThrow()
      expect(() => assertValidDataBackpackProfile(fixture)).not.toThrow()
    }
  })

  it('rejects invalid fixtures', () => {
    for (const fixture of invalidDataBackpackFixtures) {
      const issues = validateDataBackpackProfile(fixture as never)
      expect(issues.length).toBeGreaterThan(0)
      expect(() => assertValidDataBackpackProfile(fixture as never)).toThrow(
        'Data Backpack contract validation failed'
      )
    }
  })
})

describe('Social Graph contract conformance', () => {
  it('accepts valid fixtures', () => {
    for (const fixture of validSocialGraphFixtures) {
      expect(validateConnectionRecord(fixture)).toEqual([])
      expect(() => assertValidConnectionRecord(fixture)).not.toThrow()
    }
  })

  it('rejects invalid fixtures', () => {
    for (const fixture of invalidSocialGraphFixtures) {
      const issues = validateConnectionRecord(fixture as never)
      expect(issues.length).toBeGreaterThan(0)
      expect(() => assertValidConnectionRecord(fixture as never)).toThrow(
        'Social Graph contract validation failed'
      )
    }
  })
})

describe('DocuStream contract conformance', () => {
  it('accepts valid fixtures', () => {
    for (const fixture of validDocustreamFixtures) {
      expect(validateStreamItem(fixture)).toEqual([])
      expect(() => assertValidStreamItem(fixture)).not.toThrow()
    }
  })

  it('rejects invalid fixtures', () => {
    for (const fixture of invalidDocustreamFixtures) {
      const issues = validateStreamItem(fixture as never)
      expect(issues.length).toBeGreaterThan(0)
      expect(() => assertValidStreamItem(fixture as never)).toThrow(
        'DocuStream contract validation failed'
      )
    }
  })

  it('keeps valid fixture set stable', () => {
    expect(validDocustreamFixtures).toMatchSnapshot()
  })
})
