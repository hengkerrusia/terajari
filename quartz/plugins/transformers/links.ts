import { QuartzTransformerPlugin } from "../types"
import {
  FullSlug,
  RelativeURL,
  SimpleSlug,
  TransformOptions,
  stripSlashes,
  simplifySlug,
  splitAnchor,
  transformLink,
} from "../../util/path"
import path from "path"
import { visitParents } from "unist-util-visit-parents"
import { toHtml } from "hast-util-to-html"
import isAbsoluteUrl from "is-absolute-url"
import { Root, Element } from "hast"

interface Options {
  /** How to resolve Markdown paths */
  markdownLinkResolution: TransformOptions["strategy"]
  /** Strips folders from a link so that it looks nice */
  prettyLinks: boolean
  openLinksInNewTab: boolean
  lazyLoad: boolean
  externalLinkIcon: boolean
}

const defaultOptions: Options = {
  markdownLinkResolution: "absolute",
  prettyLinks: true,
  openLinksInNewTab: false,
  lazyLoad: false,
  externalLinkIcon: true,
}

/** Recursively walk a HAST element and rewrite every internal anchor's href
 * to a root-absolute path derived from its `data-slug` attribute.
 * This ensures context snippets rendered on any page resolve links correctly.
 */
function fixHrefsToAbsolute(node: Element): Element {
  const clone = JSON.parse(JSON.stringify(node)) as Element
  function walk(n: Element) {
    if (n.type === "element" && n.tagName === "a" && n.properties?.["data-slug"]) {
      n.properties.href = `/${n.properties["data-slug"]}`
    }
    if ("children" in n && Array.isArray(n.children)) {
      for (const child of n.children) {
        if (child.type === "element") walk(child as Element)
      }
    }
  }
  walk(clone)
  return clone
}

export const CrawlLinks: QuartzTransformerPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }
  return {
    name: "LinkProcessing",
    htmlPlugins(ctx) {
      return [
        () => {
          return (tree: Root, file) => {
            const curSlug = simplifySlug(file.data.slug!)
            const outgoing: Set<SimpleSlug> = new Set()
            const linkContexts: Record<SimpleSlug, string[]> = {}
            // Deferred list: collect parents during visit, serialize AFTER
            // all anchors have their data-slug set (so hrefs can be fixed)
            const contextsToExtract: Array<{ simple: SimpleSlug; parent: Element }> = []

            const transformOptions: TransformOptions = {
              strategy: opts.markdownLinkResolution,
              allSlugs: ctx.allSlugs,
            }

            visitParents(tree, "element", (node, ancestors) => {
              // rewrite all links
              if (
                node.tagName === "a" &&
                node.properties &&
                typeof node.properties.href === "string"
              ) {
                let dest = node.properties.href as RelativeURL
                const classes = (node.properties.className ?? []) as string[]
                const isExternal = isAbsoluteUrl(dest, { httpOnly: false })
                classes.push(isExternal ? "external" : "internal")

                if (isExternal && opts.externalLinkIcon) {
                  node.children.push({
                    type: "element",
                    tagName: "svg",
                    properties: {
                      "aria-hidden": "true",
                      class: "external-icon",
                      style: "max-width:0.8em;max-height:0.8em",
                      viewBox: "0 0 512 512",
                    },
                    children: [
                      {
                        type: "element",
                        tagName: "path",
                        properties: {
                          d: "M320 0H288V64h32 82.7L201.4 265.4 178.7 288 224 333.3l22.6-22.6L448 109.3V192v32h64V192 32 0H480 320zM32 32H0V64 480v32H32 456h32V480 352 320H424v32 96H64V96h96 32V32H160 32z",
                        },
                        children: [],
                      },
                    ],
                  })
                }

                // Check if the link has alias text
                if (
                  node.children.length === 1 &&
                  node.children[0].type === "text" &&
                  node.children[0].value !== dest
                ) {
                  // Add the 'alias' class if the text content is not the same as the href
                  classes.push("alias")
                }
                node.properties.className = classes

                if (isExternal && opts.openLinksInNewTab) {
                  node.properties.target = "_blank"
                }

                // don't process external links or intra-document anchors
                const isInternal = !(
                  isAbsoluteUrl(dest, { httpOnly: false }) || dest.startsWith("#")
                )
                if (isInternal) {
                  dest = node.properties.href = transformLink(
                    file.data.slug!,
                    dest,
                    transformOptions,
                  )

                  // url.resolve is considered legacy
                  // WHATWG equivalent https://nodejs.dev/en/api/v18/url/#urlresolvefrom-to
                  const url = new URL(dest, "https://base.com/" + stripSlashes(curSlug, true))
                  const canonicalDest = url.pathname
                  let [destCanonical, _destAnchor] = splitAnchor(canonicalDest)
                  if (destCanonical.endsWith("/")) {
                    destCanonical += "index"
                  }

                  // need to decodeURIComponent here as WHATWG URL percent-encodes everything
                  const full = decodeURIComponent(stripSlashes(destCanonical, true)) as FullSlug
                  const simple = simplifySlug(full)
                  outgoing.add(simple)
                  node.properties["data-slug"] = full

                  // Defer context extraction until after the full visit,
                  // so all sibling anchors in the same parent also have data-slug set
                  if (ancestors && ancestors.length > 0) {
                    let contextNode: Element | undefined = undefined;
                    // Traverse backwards from immediate parent to root
                    for (let i = ancestors.length - 1; i >= 0; i--) {
                      const current = ancestors[i] as Element;
                      if (!current.tagName) continue;
                      
                      // Prioritize outliner blocks
                      if (current.tagName === "li" || current.tagName === "blockquote") {
                        contextNode = current;
                        break;
                      }
                      
                      // Fallback to text blocks if we haven't found a better one
                      if (!contextNode && ["p", "td", "th"].includes(current.tagName)) {
                        contextNode = current;
                      }
                    }
                    
                    if (contextNode) {
                      contextsToExtract.push({ simple, parent: contextNode });
                    }
                  }
                }

                // rewrite link internals if prettylinks is on
                if (
                  opts.prettyLinks &&
                  isInternal &&
                  node.children.length === 1 &&
                  node.children[0].type === "text" &&
                  !node.children[0].value.startsWith("#")
                ) {
                  node.children[0].value = path.basename(node.children[0].value)
                }
              }

              // transform all other resources that may use links
              if (
                ["img", "video", "audio", "iframe"].includes(node.tagName) &&
                node.properties &&
                typeof node.properties.src === "string"
              ) {
                if (opts.lazyLoad) {
                  node.properties.loading = "lazy"
                }

                if (!isAbsoluteUrl(node.properties.src, { httpOnly: false })) {
                  let dest = node.properties.src as RelativeURL
                  dest = node.properties.src = transformLink(
                    file.data.slug!,
                    dest,
                    transformOptions,
                  )
                  node.properties.src = dest
                }
              }
            })

            // Now all anchors have data-slug — serialize contexts with fixed hrefs
            for (const { simple, parent: parentEl } of contextsToExtract) {
              const fixed = fixHrefsToAbsolute(parentEl)
              const contextHtml = toHtml(fixed)
              if (!linkContexts[simple]) {
                linkContexts[simple] = []
              }
              // Avoid duplicate contexts if same parent was pushed multiple times
              if (!linkContexts[simple].includes(contextHtml)) {
                linkContexts[simple].push(contextHtml)
              }
            }

            file.data.links = [...outgoing]
            file.data.linkContexts = linkContexts
          }
        },
      ]
    },
  }
}

declare module "vfile" {
  interface DataMap {
    links: SimpleSlug[]
    linkContexts: Record<SimpleSlug, string[]>
  }
}
