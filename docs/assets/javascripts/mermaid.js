window.mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral"
});

const renderMermaid = () => {
  const nodes = Array.from(
    document.querySelectorAll(".mermaid:not([data-processed='true'])")
  );
  if (nodes.length === 0) {
    return;
  }
  window.mermaid.run({ nodes }).catch((error) => {
    console.error("Mermaid rendering failed", error);
  });
};

// ``document$`` emits once for the initial page and after every Material
// instant-navigation swap, so diagrams are rendered on both code paths.
if (typeof document$ !== "undefined") {
  document$.subscribe(renderMermaid);
} else {
  document.addEventListener("DOMContentLoaded", renderMermaid);
}
