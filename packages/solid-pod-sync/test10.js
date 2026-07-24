const { buildThing, createThing, setThing, getThing, saveSolidDatasetAt, solidDatasetAsMarkdown } = require("@inrupt/solid-client");
const VCARD_FN = "http://www.w3.org/2006/vcard/ns#fn";
const webId = "https://example.com/profile/card#me";

async function main() {
  const ds = {
    type: 'Dataset',
    graphs: {
      default: {
        'https://example.com/profile/card#me': {
          type: 'Subject',
          url: 'https://example.com/profile/card#me',
          predicates: {
            'http://www.w3.org/2006/vcard/ns#fn': {
              literals: {
                'http://www.w3.org/2001/XMLSchema#string': ['Name 1', 'Name 2']
              }
            }
          }
        }
      }
    },
    internal_resourceInfo: {
      sourceIri: 'https://example.com/profile/card',
      isRawData: false,
      contentType: 'text/turtle',
      linkedResources: {}
    },
    internal_changeLog: { additions: [], deletions: [] }
  };

  let existingThing = getThing(ds, webId);

  // Use setStringNoLocale without removeAll
  let newThing = buildThing(existingThing).setStringNoLocale(VCARD_FN, "New Name").build();
  
  let newDs = setThing(ds, newThing);

  const mockFetch = async (url, options) => {
    console.log("FETCH BODY:", options.body);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => "" };
  };

  await saveSolidDatasetAt("https://example.com/profile/card", newDs, { fetch: mockFetch });
}

main().catch(console.error);
