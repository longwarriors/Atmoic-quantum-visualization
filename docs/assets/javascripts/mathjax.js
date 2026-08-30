window.MathJax = {
  tex: {
    inlineMath: [["\\(", "\\)"], ["$", "$"]],
    displayMath: [["\\[", "\\]"], ["$$", "$$"]],
    processEscapes: true,
    processEnvironments: true
  },
  options: {
    ignoreHtmlClass: ".*|",
    processHtmlClass: "arithmatex"
  },
  startup: {
    ready: () => {
      MathJax.startup.defaultReady();
      // Material's instant navigation replaces the article without a full
      // page load. Re-typeset each fresh article after that replacement.
      if (typeof document$ !== "undefined") {
        document$.subscribe(() => {
          MathJax.typesetPromise().catch((error) => {
            console.error("MathJax typesetting failed", error);
          });
        });
      }
    }
  }
};
