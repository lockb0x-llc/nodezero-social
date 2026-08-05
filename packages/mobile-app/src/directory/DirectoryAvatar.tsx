import { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { getProvisionerUrl } from '../contexts/NodeZeroSessionContext'
import { aesthetic } from '../theme/aesthetic'
import { readDirectoryAvatarDataUri } from './directoryAvatarClient'

export function DirectoryAvatar(props: {
  webId: string
  displayName: string
  avatarUrl?: string
  authFetch: typeof globalThis.fetch
}): JSX.Element {
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSource(null)
    if (!props.avatarUrl) return
    void readDirectoryAvatarDataUri({
      provisionerUrl: getProvisionerUrl(),
      webId: props.webId,
      authFetch: props.authFetch,
    }).then((value) => {
      if (!cancelled) setSource(value)
    })
    return (): void => {
      cancelled = true
    }
  }, [props.authFetch, props.avatarUrl, props.webId])

  if (source) {
    return (
      <Image
        source={{ uri: source }}
        style={styles.avatar}
        accessibilityLabel={`${props.displayName} avatar`}
        onError={() => setSource(null)}
      />
    )
  }

  return (
    <View style={styles.fallback} accessibilityLabel={`${props.displayName} avatar fallback`}>
      <Text style={styles.initial}>{(props.displayName.trim()[0] ?? '?').toUpperCase()}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: aesthetic.color.surface,
  },
  fallback: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#343842',
  },
  initial: {
    color: aesthetic.color.textHigh,
    fontSize: 16,
    fontWeight: '800',
  },
})
