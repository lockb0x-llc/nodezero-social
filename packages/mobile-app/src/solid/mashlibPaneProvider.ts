import { inferMashlibResourceType } from '@nodezero/solid-pod-sync'

export interface PaneLikeDescriptor {
  id: string
  label: string
}

function paneSetForResourceType(resourceType: ReturnType<typeof inferMashlibResourceType>): PaneLikeDescriptor[] {
  switch (resourceType) {
    case 'docustream':
      return [
        { id: 'activity', label: 'Activity Stream' },
        { id: 'timeline', label: 'Timeline View' },
        { id: 'tripledoc', label: 'Tripledoc View' },
      ]
    case 'profile':
      return [
        { id: 'profile', label: 'Profile Card' },
        { id: 'contact', label: 'Contact Details' },
      ]
    case 'social-graph':
      return [
        { id: 'social-graph', label: 'Social Graph' },
        { id: 'network', label: 'Network View' },
      ]
    case 'generic':
    default:
      return [{ id: 'tripledoc', label: 'Tripledoc View' }]
  }
}

export function listPanes(resourceUrl: string): PaneLikeDescriptor[] {
  return paneSetForResourceType(inferMashlibResourceType(resourceUrl))
}
