export type AudienceType = 'foaf' | 'verified' | 'trust-circle' | 'local'

export function getAudienceDescription(audience: AudienceType): string {
  switch (audience) {
    case 'foaf':
      return 'Close Ties (Your FOAF Network)'
    case 'verified':
      return 'Verified Humans in your Grid'
    case 'trust-circle':
      return 'Trust Circle Members'
    case 'local':
      return 'Everyone in your Local H3 Grid'
  }
}
