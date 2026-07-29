export async function retryNetworkOperation<T>(
  operation: () => Promise<T>,
  retryDelaysMs: readonly number[],
  sleep: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const retryDelay = retryDelaysMs[attempt]
      if (retryDelay === undefined) throw error
      await sleep(retryDelay)
    }
  }
}