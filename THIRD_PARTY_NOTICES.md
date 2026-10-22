# Third-party components

The original project code uses PolyForm Noncommercial 1.0.0. The bundled
components below remain licensed by their respective authors under their
original terms. All upstream notices must be retained when redistributing.

| Component | Version | License | Bundled license |
| --- | --- | --- | --- |
| [Marked](https://github.com/markedjs/marked) | 17.0.5 | MIT | [marked-LICENSE.md](vendor/marked-LICENSE.md) |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19.0 | MIT | [LICENSE](vendor/katex/LICENSE) |
| [PDF.js](https://github.com/mozilla/pdf.js) | 5.6.205 | Apache-2.0 | [LICENSE](vendor/pdfjs/LICENSE) |
| PDF.js Adobe character maps | bundled with PDF.js | BSD-style, see text | [cmaps/LICENSE](vendor/pdfjs/cmaps/LICENSE) |
| PDF.js Foxit standard fonts | bundled with PDF.js | BSD-style, see text | [LICENSE_FOXIT](vendor/pdfjs/standard_fonts/LICENSE_FOXIT) |
| PDF.js Liberation fonts | bundled with PDF.js | SIL OFL 1.1 | [LICENSE_LIBERATION](vendor/pdfjs/standard_fonts/LICENSE_LIBERATION) |

Runtime scripts, fonts, PDF character maps and standard font data are bundled
locally into the bundled UI and inline fonts; the upstream license files remain under `vendor/`. KaTeX package provenance and integrity are
recorded in `vendor/katex/source.json`. Existing embedded upstream
notices are preserved. No runtime CDN is required.

Playwright is a development-only dependency, licensed under Apache-2.0. It is
not included in the plugin package. pdf-lib (MIT) is a development-only
dependency used to create synthetic PDF test fixtures; it is also not bundled.
Git, Node.js, Microsoft Edge, ChatGPT and
OpenAI services are external tools or services, not project-owned components.

The esbuild build tool is MIT licensed and is development-only. The Obsidian API and Electron/Node.js are supplied by the host app and are not redistributed in this package.
