export function buildInteractionPreloadRuntimeState(context, interactionMetadata) {
  return {
    normalWindowsById: {
      1: {
        normalWindowId: 1,
        preloadWindow: context.createEmptyPreloadWindowState(),
        sourceTabs: {
          2: {
            sourceTabId: 2,
            hiddenTabEntriesByUrl: {
              "https://interaction.example/hidden": {
                tabId: 101,
                requestedUrl: "https://interaction.example/hidden",
                loadedUrl: "https://interaction.example/hidden",
                nodeId: "https://interaction.example",
                score: 0,
                status: "complete",
                interactionPreload: interactionMetadata,
              },
              "https://regular.example/hidden": {
                tabId: 102,
                requestedUrl: "https://regular.example/hidden",
                loadedUrl: "https://regular.example/hidden",
                nodeId: "https://regular.example",
                score: 5,
                status: "complete",
              },
              "https://bookmark.example/hidden": {
                tabId: 103,
                requestedUrl: "https://bookmark.example/hidden",
                loadedUrl: "https://bookmark.example/hidden",
                nodeId: "https://bookmark.example",
                score: 0,
                status: "complete",
                bookmarkPreload: {
                  bucketKey: "startupGoogleSearch",
                  count: 2,
                  rank: 1,
                  title: "Bookmark",
                },
              },
            },
            prerenderEntriesByUrl: {
              "https://interaction.example/prerender": {
                requestedUrl: "https://interaction.example/prerender",
                nodeId: "https://interaction.example",
                score: 0,
                status: "prerender",
                strategy: "prerender",
                targetHint: "_self",
                interactionPreload: interactionMetadata,
              },
              "https://regular.example/prerender": {
                requestedUrl: "https://regular.example/prerender",
                nodeId: "https://regular.example",
                score: 5,
                status: "prerender",
                strategy: "prerender",
                targetHint: "_self",
              },
            },
            prefetchEntriesByUrl: {
              "https://interaction.example/prefetch": {
                requestedUrl: "https://interaction.example/prefetch",
                nodeId: "https://interaction.example",
                score: 0,
                status: "prefetch",
                strategy: "prefetch",
                interactionPreload: interactionMetadata,
              },
              "https://regular.example/prefetch": {
                requestedUrl: "https://regular.example/prefetch",
                nodeId: "https://regular.example",
                score: 5,
                status: "prefetch",
                strategy: "prefetch",
              },
            },
            updatedAt: null,
          },
        },
        updatedAt: null,
      },
    },
    updatedAt: null,
  };
}
