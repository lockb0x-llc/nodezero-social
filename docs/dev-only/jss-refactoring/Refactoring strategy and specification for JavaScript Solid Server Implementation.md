## **Architectural Design & Specification: NodeZero.Social**

This document outlines the refactored architecture for **NodeZero.Social**, a standalone, privacy-preserving social platform. It leverages **Stellar Protocol 27** for smart contract execution and the **JavaScript Solid Server (JSS)** instead of the current (CSS) Community Solid Server for decentralized data storage, unified by a **Zero-Knowledge (ZK) linkage layer**.

### **1\. System Architecture Overview**

NodeZero.Social is built as a brand-new, standalone repository. It decouples identity and storage from centralized databases, using the following stack:

* **Identity Layer:** Stellar Account (G-account) linked to a Lockb0x Smart Contract account.  
* **Storage Layer:** JavaScript Solid Server (JSS), providing decentralized "Data Backpacks" (Pods).  
* **Verification Layer:** ZK-Proof linkage verifying the connection between the user's Stellar account and their Solid WebID/Pod.  
* **Contract Factory:** A Soroban-based factory contract on Stellar TestNet that instantiates unique Lockb0x accounts for new users.

### **2\. Lockb0x Smart Contract Factory (Stellar Protocol 27\)**

The factory resides on the Stellar TestNet and is responsible for provisioning on-chain "Smart Accounts."

* **Functionality:** Upon user registration, the factory instantiates a new Lockb0x contract. This contract serves as the user’s on-chain sovereign identity anchor.  
* **Protocol 27 Integration:** The factory utilizes native Stellar Protocol 27 features to handle complex authorization flows and state management, ensuring the Lockb0x contract maintains its own balance and execution footprint.  
* **Deployment:** soroban-cli is utilized to deploy the factory and manage contract lifecycle events.

### **3\. JSS Solid Pod Architecture**

To meet the high-speed requirements of the upcoming hackathon, we utilize the **JavaScript Solid Server (JSS)**.

* **Deployment:** The application initiates a JSS instance using the npx jspod command-line wrapper. This provisions a Pod in under 60 seconds, including a data browser and a local identity provider.  
* **Authentication (The "Auth Ladder"):**  
  * **Baseline:** Nostr NIP-98 keypairs and did:nostr identifiers are used to bootstrap the account without traditional email/password registration.  
  * **Upgrades:** The JSS dashboard supports biometric Passkeys, allowing users to "upgrade" their session security without centralizing their identity.  
  * **FedCM:** Integration with the Federated Credential Management (FedCM) API allows for "Sign in with Solid" flows that mimic modern Web 2.0 experiences while maintaining absolute cryptographic decentralization.

### **4\. ZK-Linkage Layer (Stellar \+ Solid)**

The core mission of NodeZero.Social is to cryptographically prove that Stellar Account A owns Solid WebID B.

1. **Proof Generation:** The client application uses the user's private key to sign a ZK proof (serialized as JSON-LD Verifiable Credentials).  
2. **Verification:** The Solid Pod’s authentication middleware verifies the signature against the Lockb0x contract state on the Stellar TestNet.  
3. **Runtime Composition:** Once verified, the application treats the Stellar account and the Solid Pod as a single, cryptographically bound entity. This linkage is used to authorize data reads/writes in the Pod and to sign social interactions on the platform.

### **5\. Engineering Handoff: Specifications**

| Component | Technology | Role |
| :---- | :---- | :---- |
| **Backend/Storage** | JavaScript Solid Server (JSS) | Decentralized Pod hosting; JSON-LD native. |
| **Blockchain** | Stellar Protocol 27 (Soroban) | Lockb0x Factory & Smart Account state. |
| **Auth** | Nostr NIP-98 / Passkeys | Passwordless, decentralized login. |
| **Interoperability** | FedCM API | Standardized "Sign-in" browser integration. |
| **Communication** | JSON-LD / W3C VCs | Format for ZK linkage proofs. |

#### **Implementation Checklist for Engineering:**

1. **Environment:** Provision local jspod instances for the development team.  
2. **Contract:** Compile the Lockb0x factory using cargo and deploy to Stellar TestNet.  
3. **Integration:** Implement the ZK-signature check within the JSS OIDC-provider flow.  
4. **UX:** Configure the React-based frontend to handle the silent Pod-provisioning flow during the initial user onboarding state.

*This architecture bypasses legacy bloat, focusing entirely on the high-fidelity linkage between the Stellar blockchain and the decentralized Solid ecosystem.*