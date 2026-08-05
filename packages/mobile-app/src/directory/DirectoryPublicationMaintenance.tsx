import { useEffect } from 'react'
import { useNodeZeroSession, getProvisionerUrl } from '../contexts/NodeZeroSessionContext'
import { useWallet } from '../contexts/WalletContext'
import { getSolidPodSyncManagers } from '../solid/podSyncManagers'
import { readDirectoryFeatureAvailability } from './directoryFeatureClient'
import { maintainDirectoryPublication } from './directoryPublication'

export function DirectoryPublicationMaintenance(): null {
  const { status, webId, authFetch } = useNodeZeroSession()
  const { attestationStatus } = useWallet()

  useEffect(() => {
    if (status !== 'authenticated' || attestationStatus !== 'verified' || !webId) return
    const provisionerUrl = getProvisionerUrl()
    const podRoot = `${webId.split('/profile/')[0]}/`
    void readDirectoryFeatureAvailability(provisionerUrl, authFetch)
      .then((features) =>
        maintainDirectoryPublication({
          available: features.directory,
          podRoot,
          ownerWebId: webId,
          provisionerUrl,
          authFetch,
          managers: getSolidPodSyncManagers({ fetch: authFetch }),
        })
      )
      .catch(() => undefined)
  }, [attestationStatus, authFetch, status, webId])

  return null
}
