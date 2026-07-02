/**
 * @module DiscoveryContext
 *
 * Provides the current H3 geo-discovery state to the component tree.
 * The device location is obtained via `expo-location` and converted to an
 * H3 index using `@nodezero/geo-discovery`.  The raw GPS coordinate is NEVER
 * stored or transmitted – only the H3 cell index is shared with peers.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as Location from 'expo-location'
import { H3Grid, type LocalNode, type SurroundingNodesResult } from '@nodezero/geo-discovery'

/** Shape of the discovery context value. */
interface DiscoveryContextValue {
  /** The user's current H3 cell, or `null` if location is unavailable. */
  currentNode: LocalNode | null
  /** The current cell plus its 6 immediate neighbours. */
  surroundingNodes: LocalNode[]
  /** Permission + availability status of location services. */
  locationStatus: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'
  /** Explicitly request location permission and start live updates. */
  requestAccess: () => Promise<void>
  /** Manually refresh the current position. */
  refresh: () => Promise<void>
}

const DiscoveryContext = createContext<DiscoveryContextValue | null>(null)

const grid = new H3Grid(9)

/**
 * Provides H3 geo-discovery state to child components.
 * Should be placed near the root layout so all screens have access.
 */
export function DiscoveryProvider({ children }: { children: ReactNode }): JSX.Element {
  const [currentNode, setCurrentNode] = useState<LocalNode | null>(null)
  const [surroundingNodes, setSurroundingNodes] = useState<LocalNode[]>([])
  const [locationStatus, setLocationStatus] = useState<DiscoveryContextValue['locationStatus']>('idle')
  const watchRef = useRef<Location.LocationSubscription | null>(null)

  const applyPosition = useCallback((lat: number, lng: number) => {
    grid.updatePosition(lat, lng)
    const result: SurroundingNodesResult = grid.getSurroundingNodes()
    setCurrentNode(result.originNode)
    setSurroundingNodes(result.surroundingNodes)
  }, [])

  const startWatching = useCallback(async () => {
    watchRef.current?.remove()
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 10_000, distanceInterval: 50 },
      (location) => {
        applyPosition(location.coords.latitude, location.coords.longitude)
      }
    )
  }, [applyPosition])

  const refresh = useCallback(async () => {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      applyPosition(location.coords.latitude, location.coords.longitude)
    } catch {
      setLocationStatus('unavailable')
    }
  }, [applyPosition])

  const requestAccess = useCallback(async () => {
    setLocationStatus('requesting')
    const { status } = await Location.requestForegroundPermissionsAsync()

    if (status !== Location.PermissionStatus.GRANTED) {
      setLocationStatus('denied')
      return
    }

    setLocationStatus('granted')
    await startWatching()
    await refresh()
  }, [refresh, startWatching])

  useEffect(() => {
    void (async () => {
      const { status } = await Location.getForegroundPermissionsAsync()

      if (status === Location.PermissionStatus.GRANTED) {
        setLocationStatus('granted')
        await startWatching()
        await refresh()
        return
      }

      if (status === Location.PermissionStatus.DENIED) {
        setLocationStatus('denied')
        return
      }

      setLocationStatus('idle')
    })()

    return () => {
      watchRef.current?.remove()
    }
  }, [refresh, startWatching])

  return (
    <DiscoveryContext.Provider value={{ currentNode, surroundingNodes, locationStatus, requestAccess, refresh }}>
      {children}
    </DiscoveryContext.Provider>
  )
}

/**
 * Hook to access geo-discovery state.
 * Must be used inside a `DiscoveryProvider`.
 */
export function useDiscovery(): DiscoveryContextValue {
  const ctx = useContext(DiscoveryContext)
  if (!ctx) throw new Error('useDiscovery must be used inside <DiscoveryProvider>')
  return ctx
}
