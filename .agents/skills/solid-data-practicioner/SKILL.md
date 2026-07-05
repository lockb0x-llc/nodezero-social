# Solid Data Modelling Skill

You are an expert on data modelling for the Solid ecosystem. This includes FAIR data principles, RDF vocabularies and ontologies and SHACL shapes.

---

## FAIR Data Principles in Solid

FAIR Data Principles (*Findable, Accessible, Interoperable, Reusable*) describe guidelines for improving data usability in open and distributed systems. In the context of Solid data modelling, implementing FAIR principles ensures data can be easily discovered, accessed, combined, understood, and reused across applications and domains.

| Principle | Solid Implementation |
|-----------|---------------------|
| **Findable** | Resources have dereferenceable HTTP URIs; The Solid Type Index provides a standard machine-readable discovery mechanism to enable data discovery in a Solid pod |
| **Accessible** | Resources are served over standard HTTP with authentication (Solid-OIDC) and authorisation (ACP/WAC) |
| **Interoperable** | Data uses RDF with standard vocabularies (schema.org, FOAF, LDP, etc.) |
| **Reusable** | Shapes (SHACL) define reusable data schemas; linked data enables cross-app data reuse |

### Applying FAIR in Practice

1. **Mint stable URIs** — use consistent URI patterns for resources
2. **Use standard vocabularies** — reuse standard vocabularies e.g. schema.org, FOAF, Dublin Core, SKOS where possible
3. **Describe your data in machine-readable format** — add RDF type statements and metadata to every resource
4. **Publish shapes** — provide SHACL shapes so consuming apps can validate the data
5. **Link datasets** — use `rdfs:seeAlso` for generic related-resource links, `skos:exactMatch` only when two concepts are semantically equivalent, and `owl:sameAs` when two URIs denote the exact same real-world entity

---

## RDF Vocabulary Selection

### Core Vocabularies for Solid

| Prefix               | Full Name          | Description                                  | Namespace URL                                                                              |
| -------------------- | ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `acp:`               | ACP                | Access Control Policy Language               | [http://www.w3.org/ns/solid/acp#](http://www.w3.org/ns/solid/acp#)                         |
| `as:`                | AS (ActivityStreams) | Social activities, notifications           | [https://www.w3.org/ns/activitystreams#](https://www.w3.org/ns/activitystreams#)           |
| `dc:` / `dcterms:`   | DC                 | Metadata (title, creator, date, description) | [http://purl.org/dc/terms/](http://purl.org/dc/terms/)                                     |
| `foaf:`              | FOAF               | Person, identity, social graph               | [http://xmlns.com/foaf/0.1/](http://xmlns.com/foaf/0.1/)                                   |
| `ical:`              | ICAL               | Calendar data                                | [http://www.w3.org/2002/12/cal/ical#](http://www.w3.org/2002/12/cal/ical#)                 |
| `ldp:`               | LDP                | Containers, membership                       | [http://www.w3.org/ns/ldp#](http://www.w3.org/ns/ldp#)                                     |
| `org:`               | ORG                | Organization ontology                        | [http://www.w3.org/ns/org#](http://www.w3.org/ns/org#)                                     |
| `owl:`               | OWL                | Ontology relations, sameAs                   | [http://www.w3.org/2002/07/owl#](http://www.w3.org/2002/07/owl#)                           |
| `pim:`               | PIM                | Storage, preferences, configuration          | [http://www.w3.org/ns/pim/space#](http://www.w3.org/ns/pim/space#)                         |
| `posix:`             | POSIX              | POSIX file system permissions                | [http://www.w3.org/ns/posix/stat#](http://www.w3.org/ns/posix/stat#)                       |
| `rdf:`               | RDF                | RDF syntax concepts                          | [http://www.w3.org/1999/02/22-rdf-syntax-ns#](http://www.w3.org/1999/02/22-rdf-syntax-ns#) |
| `rdfs:`              | RDFS               | Labels, comments, subclass relationships     | [http://www.w3.org/2000/01/rdf-schema#](http://www.w3.org/2000/01/rdf-schema#)             |
| `schema:`            | Schema.org         | Structured data vocabulary                   | [https://schema.org/](https://schema.org/)                                                 |
| `solid:`             | Solid              | OIDC, notifications, identity                | [https://www.w3.org/ns/solid/](https://www.w3.org/ns/solid/)                               |
| `vcard:`             | vCard              | Contact information                          | [http://www.w3.org/2006/vcard/ns#](http://www.w3.org/2006/vcard/ns#)                       |


### Vocabulary Lookup

Before creating custom RDF classes and properties, search existing ontologies/vocabularies:

- **Linked Open Vocabularies (LOV)**: https://lov.linkeddata.es/
- **schema.org**: https://schema.org/ — widely adopted, search-engine friendly
- If no suitable term exists after searching LOV and schema.org, mint a custom term under a stable namespace you control (e.g. `https://example.org/vocab#MyTerm`), document it with `rdfs:label`, `rdfs:comment`, and `rdfs:isDefinedBy`, and submit it to LOV for discoverability.

---

## Shapes: SHACL

Shapes define the expected structure of RDF data. They serve as schemas for validation and code generation.

### SHACL (Shapes Constraint Language)

[SHACL](https://www.w3.org/TR/shacl/) is the W3C Recommendation for RDF validation, more expressive for complex constraints.

```turtle
@prefix sh: <http://www.w3.org/ns/shacl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

<PersonShape>
    a sh:NodeShape ;
    sh:targetClass foaf:Person ;
    sh:property [
        sh:path foaf:name ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
    ] ;
    sh:property [
        sh:path foaf:mbox ;
        sh:nodeKind sh:IRI ;
        sh:maxCount 1 ;
    ] .
```

### SHACL Shape Discovery


A number of **public SHACL shapes collections and published shapes** are available that you can reuse or study:

- **[Solid Shapes Catalogue](https://github.com/solid/shapes)**  
  Provides reusable SHACL shapes used in Solid ecosystem applications.

- **[W3C Data Shapes Working Group Resources](https://github.com/w3c/data-shapes)**  
  Official working group repository containing specifications, examples, and discussion materials related to RDF data shapes.

- **[Awesome Semantic Shapes Curated List](https://github.com/w3c-cg/awesome-semantic-shapes)**  
  Broad index of SHACL and ShEx shape resources across domains and vocabularies.

- **Shapes-of-You Semantic Index**  
  A public index of semantic web resources that helps researchers discover linked data artefacts including SHACL shapes, ontologies, mappings, and SPARQL assets.  
  https://index.semanticscience.org/

- **[SHACL Play! Shapes Catalog (SKOS & vocab constraint shapes)](https://shacl-play.sparna.fr/play/shapes-catalog)**  
  Provides ready-to-use SKOS validation shapes implementing many SKOS integrity constraints.

- **[SEMICeu DCAT-AP SHACL Shapes](https://github.com/SEMICeu/dcat-ap_shacl/blob/master/README.md)**  
  Repository containing SHACL shapes for the DCAT-AP data catalogue application profile.
---

## MCP Adapters for Ontology Discovery

Model Context Protocol (MCP) adapters allow AI tools and development environments to discover and work with ontologies and shapes programmatically.

### Discovering Ontologies via MCP

When building an MCP adapter for ontology discovery, key capabilities to expose:

1. **Search by term** — find classes and properties matching a keyword
2. **Shape retrieval** — fetch SHACL shapes for a known type
3. **Type index traversal** — discover where a user stores instances of a given type on their pod

### Recommended Approach for Ontology Discovery in Apps

```
1. Check LOV (lov.linkeddata.es) for existing vocabulary terms
2. Use SHACL shapes (from Solid shapes repo) to validate data
3. For pod-specific discovery, traverse the pod's Type Index
```

---

### Structure

```turtle
# Public type index at /settings/publicTypeIndex.ttl

@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix schema: <https://schema.org/>.

<#registration-contacts>
    a solid:TypeRegistration ;
    solid:forClass schema:Person ;
    solid:instanceContainer </contacts/> .

<#registration-notes>
    a solid:TypeRegistration ;
    solid:forClass schema:TextObject ;
    solid:instance </notes/main.ttl> .
```

### Two Registration Types

| Property | Meaning |
|----------|---------|
| `solid:instanceContainer` | All instances of this type live in this container |
| `solid:instance` | A single document containing instances of this type |

### Accessing the Solid Type Index

1. Fetch the user's WebID profile
2. Find `solid:publicTypeIndex` and/or `solid:privateTypeIndex` predicates
3. Fetch the Solid Type Index document
4. Query for `solid:TypeRegistration` entries with matching `solid:forClass`

---

## Data Modelling Checklist

When modelling a new data type for Solid:

- [ ] Check for existing SHACL shapes with types that meet your requirements
- [ ] Check LOV for an existing vocabulary/class
- [ ] Define a SHACL shape for the type
- [ ] Add `rdf:type` statements to all instances
- [ ] Register the type in the pod's Solid Type Index
- [ ] Use stable, dereferenceable URIs for subjects
- [ ] Add `dcterms:created`, `dcterms:modified` metadata
- [ ] Document the shape in a public shapes repository
- [ ] Validate data against the shape before writing to the pod

---

## Resources

| Resource | URL |
|----------|-----|
| FAIR Principles | https://www.go-fair.org/fair-principles/ |
| Linked Open Vocabularies | https://lov.linkeddata.es/ |
| W3C SHACL Spec | https://www.w3.org/TR/shacl/ |
| W3C Data Shapes repo | https://github.com/w3c/data-shapes |
| Solid type indexes | https://solid.github.io/type-indexes/ |
| Shapes resources | https://github.com/w3c-cg/awesome-semantic-shapes |
| Solid Developer Documentation | https://dev.solidproject.org/ |