# NodeZero Social Wiki

NodeZero Social is a decentralized social platform built as a monorepo with mobile, relay, data sync, wallet, and infrastructure packages.

## Quick links

- [Architecture](Architecture)
- [Getting Started](Getting-Started)
- [Mobile App](Mobile-App)
- [Solid Pod Sync](Solid-Pod-Sync)
- [P2P Comms](P2P-Comms)
- [Relay Service](Relay-Service)
- [Embedded Wallet](Embedded-Wallet)
- [ZK Crypto](ZK-Crypto)
- [Smart Contracts](Smart-Contracts)
- [Azure Platform](Azure-Platform)
- [Geo Discovery](Geo-Discovery)
- [Contributing](Contributing)
- [Security](Security)
- [Roadmap](Roadmap)
- [FAQ](FAQ)

## Architecture at a glance

```mermaid
flowchart LR
  Mobile[mobile-app] --> Solid[solid-pod-sync]
  Mobile --> P2P[p2p-comms]
  P2P --> Relay[relay-service]
  Mobile --> Wallet[embedded-wallet]
  Wallet --> Stellar[contracts]
  Mobile --> Geo[geo-discovery]
  Infra[infrastructure/azure] --> Mobile
  Infra --> Relay
```

## Source references

- Monorepo overview: ../README.md
- Staging release requirements: ../docs/testnet-azure-release-requirements.md
- Staging UAT checklist: ../docs/staging-uat-checklist.md
