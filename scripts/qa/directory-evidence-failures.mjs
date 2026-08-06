export async function ensureDirectoryUnpublished({
  isPublished,
  unpublish,
  waitForUnpublishedIntent,
  retryProjection,
  readProjection,
  projectionContainsAccount,
}) {
  if (await isPublished()) {
    await unpublish()
    await waitForUnpublishedIntent()
  }
  await retryProjection()
  const projection = await readProjection()
  if (projectionContainsAccount(projection)) {
    throw new Error('Directory cleanup could not remove the account projection.')
  }
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
