import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  DirectoryCleanupStageError,
  directoryEvidenceFailure,
  ensureDirectoryUnpublished,
} from './directory-evidence-failures.mjs'

void test('cleanup is idempotent when publication is already off', async () => {
  const calls = []
  await ensureDirectoryUnpublished({
    isPublished: async () => false,
    unpublish: async () => calls.push('unpublish'),
    waitForUnpublishedIntent: async () => calls.push('wait'),
    retryProjection: async () => calls.push('retry'),
    readProjection: async () => {
      calls.push('read')
      return { members: [] }
    },
    projectionContainsAccount: () => false,
  })
  assert.deepEqual(calls, ['retry', 'read'])
})

void test('cleanup unpublishes and rejects a retained projection', async () => {
  const calls = []
  await assert.rejects(
    ensureDirectoryUnpublished({
      isPublished: async () => true,
      unpublish: async () => calls.push('unpublish'),
      waitForUnpublishedIntent: async () => calls.push('wait'),
      retryProjection: async () => calls.push('retry'),
      readProjection: async () => {
        calls.push('read')
        return { members: [{ identityHash: 'opaque' }] }
      },
      projectionContainsAccount: (projection) => projection.members.length > 0,
    }),
    (error) =>
      error instanceof DirectoryCleanupStageError &&
      error.stage === 'projection removal verification'
  )
  assert.deepEqual(calls, ['unpublish', 'wait', 'retry', 'read'])
})

void test('reports the exact cleanup stage without retaining its underlying error', async () => {
  const privateError = new Error('private account detail')
  await assert.rejects(
    ensureDirectoryUnpublished({
      isPublished: async () => true,
      unpublish: async () => {},
      waitForUnpublishedIntent: async () => {
        throw privateError
      },
      retryProjection: async () => {},
      readProjection: async () => ({ members: [] }),
      projectionContainsAccount: () => false,
    }),
    (error) => {
      assert(error instanceof DirectoryCleanupStageError)
      assert.equal(error.stage, 'Pod intent confirmation')
      assert.equal(error.cause, undefined)
      assert.doesNotMatch(error.message, /private account detail/)
      return true
    }
  )
})

void test('preserves the primary journey error when cleanup succeeds', () => {
  const primaryError = new Error('publish failed')
  assert.equal(directoryEvidenceFailure(primaryError), primaryError)
})

void test('aggregates cleanup failures without replacing the primary error', () => {
  const primaryError = new Error('publish failed')
  const cleanupFailure = directoryEvidenceFailure(primaryError, [
    { phase: 'unpublish verification', error: new Error('private account detail') },
  ])

  assert(cleanupFailure instanceof AggregateError)
  assert.equal(cleanupFailure.cause, primaryError)
  assert.equal(cleanupFailure.errors[0], primaryError)
  assert(cleanupFailure.errors[1] instanceof AggregateError)
  assert.match(cleanupFailure.errors[1].message, /unpublish verification/)
  assert.doesNotMatch(cleanupFailure.message, /private account detail/)
  assert.doesNotMatch(cleanupFailure.errors[1].message, /private account detail/)
})

void test('aggregates multiple cleanup-only failures by phase', () => {
  const cleanupFailure = directoryEvidenceFailure(null, [
    { phase: 'unpublish verification', error: new Error('first') },
    { phase: 'browser close', error: new Error('second') },
  ])

  assert(cleanupFailure instanceof AggregateError)
  assert.match(cleanupFailure.message, /unpublish verification, browser close/)
  assert.equal(cleanupFailure.errors.length, 2)
})
