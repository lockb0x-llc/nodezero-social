targetScope = 'subscription'

@description('Resource group for the portable Docker Compose staging host.')
param resourceGroupName string = 'rg-nodezero-social-portable-staging'

@description('Azure region for the portable staging host.')
param location string = 'eastus2'

@description('VM name.')
param vmName string = 'nodezero-portable-staging'

@description('Small MVP VM size.')
param vmSize string = 'Standard_B2s'

@description('Key Vault name for portable staging secrets. Must be globally unique and 3-24 alphanumeric characters.')
param keyVaultName string = 'nzportable${uniqueString(subscription().id, resourceGroupName)}'

@description('Linux administrator username. Password authentication is disabled.')
param adminUsername string = 'nodezeroadmin'

@description('SSH public key for the Linux administrator.')
param sshPublicKey string

@description('Ubuntu 22.04 LTS Gen2 image version published in eastus2.')
param imageVersion string = '22.04.202608060'

resource portableResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    application: 'nodezero-social'
    environment: 'staging-testnet'
    deploymentShape: 'portable-docker-compose'
    runtimeBoundary: 'non-production'
  }
}

module host 'portable-staging-vm.resources.bicep' = {
  name: 'portable-staging-vm-resources'
  scope: portableResourceGroup
  params: {
    location: location
    vmName: vmName
    vmSize: vmSize
    adminUsername: adminUsername
    sshPublicKey: sshPublicKey
    imageVersion: imageVersion
    keyVaultName: keyVaultName
  }
}

output resourceGroupName string = portableResourceGroup.name
output vmName string = host.outputs.vmName
output publicIpAddress string = host.outputs.publicIpAddress
output sshCommand string = 'ssh ${adminUsername}@${host.outputs.publicIpAddress}'
output keyVaultName string = host.outputs.keyVaultName
output keyVaultUri string = host.outputs.keyVaultUri
