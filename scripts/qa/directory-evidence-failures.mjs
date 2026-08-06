export class DirectoryCleanupStageError extends Error {
  constructor(stage) {
    super(`Directory cleanup failed during ${stage}.`)
    this.name = 'DirectoryCleanupStageError'
    this.stage = stage
  }
}

async function runCleanupStage(stage, operation) {
  try {
    return await operation()
  } catch {
    throw new DirectoryCleanupStageError(stage)
  }
}

export async function ensureDirectoryUnpublished({
  isPublished,
  unpublish,
  waitForUnpublishedIntent,
  retryProjection,
  readProjection,
  projectionContainsAccount,
}) {
  const published = await runCleanupStage('publication state read', isPublished)
  if (published) {
    await runCleanupStage('unpublish submission', unpublish)
    await runCleanupStage('Pod intent confirmation', waitForUnpublishedIntent)
  }
  await runCleanupStage('projection retry', retryProjection)
  const projection = await runCleanupStage('projection read', readProjection)
  await runCleanupStage('projection removal verification', async () => {
    if (projectionContainsAccount(projection)) throw new Error('Projection remained listed.')
  })
}

export function directoryEvidenceFailure(primaryError, cleanupFailures = []) {
  const failures = cleanupFailures.filter((failure) => failure?.error)
  if (!primaryError && failures.length === 0) return null
  if (primaryError && failures.length === 0) return primaryError

  const cleanupError = new AggregateError(
    failures.map(({ phase }) => new Error(`Directory E2E cleanup phase failed: ${phase}.`)),
    `Directory E2E cleanup failed in ${failures.map(({ phase }) => phase).join(', ')}.`
  )
  if (!primaryError) return cleanupError

  return new AggregateError(
    [primaryError, cleanupError],
    'Directory E2E journey failed and cleanup also failed.',
    { cause: primaryError }
  )
}
