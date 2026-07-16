You’re bumping into the core tension of Solid: it’s brilliant as a protocol, but raw CSS is not an app platform. So let’s treat CSS as a **data/identity engine** inside NodeZero.social, and design “internal Pods” as a multi-tenant layer you own.

---

### High-level architecture

**Goal:**  
Each NodeZero user gets a Solid-compliant Pod, but:

- You control identity and onboarding.
- Users never see Solid’s OIDC redirect flow.
- Your backend talks to CSS; your frontend talks only to your backend.

**Core components:**

- **CSS instance(s):** Multi-tenant Pod server.
- **NodeZero Identity Service:** Your login/signup (email, passkey, OAuth, etc.).
- **Pod Provisioning Service:** Creates and manages Pods in CSS for each user.
- **Pod Access Proxy:** Backend API that reads/writes Pod data on behalf of users.
- **Social Graph Service:** Indexes Pod data for feeds, search, recommendations.

---

### 1. Identity: NodeZero-first, Solid-second

- **Primary identity:** NodeZero account (`user_id`).
- **Derived identity:** CSS account + WebID per user.

**Flow:**

1. User signs up/logs in with NodeZero identity (no Solid redirects).
2. Backend checks if user already has an internal Pod.
3. If not, it:
   - Creates a CSS account (via `.account` API or admin config).   [Github](https://github.com/CommunitySolidServer/CommunitySolidServer/blob/main/documentation/markdown/usage/identity-provider.md)  
   - Creates a Pod for that account (e.g., `/pods/{user_id}/`).   [Github](https://github.com/CommunitySolidServer/CommunitySolidServer/blob/main/documentation/markdown/usage/identity-provider.md)  
   - Generates/links a WebID (e.g., `https://nodezero.social/pods/{user_id}/profile/card#me`).

You store:

- **`user_id` → `pod_base_url` → `webid` → `css_account_id`**

You never expose CSS login to the user.

---

### 2. Pod model: multi-tenant CSS

Use CSS as a **multi-tenant Pod host**:

- **Single CSS instance** with:
  - File-based or DB-backed storage.   [communitysolidserver.github.io](https://communitysolidserver.github.io/CommunitySolidServer/4.x/docs/)  
  - Subfolder or subdomain pods (e.g., `/u/{user_id}/` or `{user_id}.pods.nodezero.social`).   [Github](https://github.com/CommunitySolidServer/CommunitySolidServer/blob/main/documentation/markdown/usage/identity-provider.md)  

**Recommended:**

- **Subfolder pods** for simplicity:  
  `https://pods.nodezero.social/u/{user_id}/`

- Each Pod contains:
  - `profile/` (user profile, preferences)
  - `social/` (posts, relationships)
  - `settings/` (privacy, app config)
  - `inbox/` (notifications, messages)

---

### 3. Pod provisioning service

A small backend service that:

- **On user creation:**
  - Calls CSS admin / setup endpoints or uses a preconfigured template to create:
    - Account
    - Pod
    - WebID
  - Writes initial RDF documents (profile, ACL, etc.).

- **On user deletion:**
  - Marks Pod as inactive or archives it.
  - Optionally exports Pod data for portability.

You can implement this as:

- **Node.js service** using `@solid/community-server` APIs and direct HTTP calls.   [communitysolidserver.github.io](https://communitysolidserver.github.io/CommunitySolidServer/4.x/docs/)  

---

### 4. Pod access proxy (backend API)

Your frontend never calls CSS directly.

Instead, it calls your **Pod Access Proxy**:

- **Responsibilities:**
  - Map `user_id` → `pod_base_url`.
  - Perform authenticated HTTP requests to CSS.
  - Handle RDF parsing/serialization.
  - Enforce NodeZero-level permissions (e.g., blocking, moderation).
  - Cache hot data (feeds, profiles).

**Patterns:**

- **Read path:**
  - Frontend → NodeZero API → Pod Access Proxy → CSS → RDF → JSON → frontend.
- **Write path:**
  - Frontend → NodeZero API → Pod Access Proxy → CSS (PUT/PATCH) → index in Social Graph Service.

This keeps Solid complexity out of the client.

---

### 5. Data model inside Pods

Design your RDF so it’s:

- **Solid-compliant**, but
- **Optimized for social use cases**.

Example layout:

- **Profile:**  
  `.../profile/card`  
  - Basic FOAF/VCARD + custom NodeZero terms.

- **Posts:**  
  `.../social/posts/{post_id}`  
  - Each post as a separate resource (LDP).   [communitysolidserver.github.io](https://communitysolidserver.github.io/CommunitySolidServer/4.x/docs/)  

- **Relationships (follows, friends):**  
  `.../social/graph`  
  - Triples like `:me nodezero:follows <webid>`.

- **Settings:**  
  `.../settings/privacy`  
  - App-specific vocab.

You can define a `nodezero:` namespace for custom predicates.

---

### 6. ACL / access control

For internal Pods, you can simplify:

- **Default ACL:**
  - Owner (user’s WebID) has full access.
  - NodeZero backend WebID (service identity) has read/write where needed.
  - Public read for selected resources (e.g., public posts, profile).   [communitysolidserver.github.io](https://communitysolidserver.github.io/CommunitySolidServer/4.x/docs/)  

- **Implementation:**
  - Use WAC/ACP via CSS config and initial ACL documents.   [communitysolidserver.github.io](https://communitysolidserver.github.io/CommunitySolidServer/7.x/architecture/features/accounts/overview/)  
  - Generate ACL files during Pod provisioning.

This lets you:

- Keep Solid semantics.
- Still enforce NodeZero-level rules via the proxy.

---

### 7. Operational considerations

- **Storage backend:**  
  - Start with filesystem or simple DB-backed CSS config.   [communitysolidserver.github.io](https://communitysolidserver.github.io/CommunitySolidServer/4.x/docs/)  
  - Plan for sharding or multiple CSS instances later.

- **Scaling:**
  - CSS for Pod storage.
  - Separate NodeZero services for:
    - Identity
    - Pod provisioning
    - Pod access proxy
    - Social graph indexing

- **Migration path:**
  - Later, allow:
    - Export of internal Pod to external provider.
    - Linking external Pods instead of internal ones.

---

If you want, next step could be:  
- Designing the **Pod Access Proxy API** (endpoints, auth, data formats), or  
- Sketching the **RDF vocab + resource layout** for posts, profiles, and relationships.