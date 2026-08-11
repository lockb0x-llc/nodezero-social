export async function waitForReleaseEvents({
  loadEvents,
  expectedChildIds,
  requireEvents,
  attempts,
  delayMs,
  readChildId,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onRetry = () => undefined,
}) {
  const observedEvents = new Map()
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const events = await loadEvents()
    for (const [index, event] of events.entries()) {
      const key =
        event && typeof event === 'object' && 'id' in event
          ? String(event.id)
          : `${String(attempt)}:${String(index)}`
      observedEvents.set(key, event)
    }
    const accumulatedEvents = [...observedEvents.values()]
    const observedChildIds = new Set()
    for (const event of accumulatedEvents) {
      try {
        const childId = readChildId(event)
        if (childId) observedChildIds.add(childId)
      } catch {
        // The substantive audit reports malformed events after discovery settles.
      }
    }
    const missingExpected = [...expectedChildIds].filter((id) => !observedChildIds.has(id))
    const ready = missingExpected.length === 0 && (!requireEvents || accumulatedEvents.length > 0)
    if (ready || attempt === attempts) return accumulatedEvents
    onRetry({ attempt, attempts, eventCount: accumulatedEvents.length, missingExpected })
    await wait(delayMs)
  }
  return [...observedEvents.values()]
}
