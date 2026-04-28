import { QuartzEmitterPlugin } from "../types"
import { QuartzComponent, QuartzComponentProps } from "../../components/types"
import HeaderConstructor from "../../components/Header"
import BodyConstructor from "../../components/Body"
import { pageResources, renderPage } from "../../components/renderPage"
import { FullPageLayout } from "../../cfg"
import { FullSlug, pathToRoot, simplifySlug } from "../../util/path"
import { defaultListPageLayout, sharedPageComponents } from "../../../quartz.layout"
import { write } from "./helpers"
import { defaultProcessedContent, QuartzPluginData } from "../vfile"
import { BuildCtx } from "../../util/ctx"
import { StaticResources } from "../../util/resources"
const UnresolvedContent: QuartzComponent = () => {
  return (
    <div class="unresolved-content">
      <p><i>This page has not been created yet, but it is referenced by other pages.</i></p>
    </div>
  )
}

async function processUnresolvedPage(
  ctx: BuildCtx,
  slug: FullSlug,
  allFiles: QuartzPluginData[],
  opts: FullPageLayout,
  resources: StaticResources,
) {
  const cfg = ctx.cfg.configuration
  const externalResources = pageResources(pathToRoot(slug), resources)

  // Create a minimal virtual file for the unresolved page
  const title = slug.split("/").pop() || slug
  const [tree, vfile] = defaultProcessedContent({
    slug,
    frontmatter: { title, tags: [] },
  })

  const componentData: QuartzComponentProps = {
    ctx,
    fileData: vfile.data,
    externalResources,
    cfg,
    children: [],
    tree,
    allFiles,
  }

  const content = renderPage(cfg, slug, componentData, opts, externalResources)
  return write({
    ctx,
    content,
    slug,
    ext: ".html",
  })
}

export const UnresolvedPage: QuartzEmitterPlugin<Partial<FullPageLayout>> = (userOpts) => {
  const opts: FullPageLayout = {
    ...sharedPageComponents,
    ...defaultListPageLayout,
    pageBody: UnresolvedContent,
    ...userOpts,
  }

  const { head: Head, header, beforeBody, pageBody, afterBody, left, right, footer: Footer } = opts
  const Header = HeaderConstructor()
  const Body = BodyConstructor()

  return {
    name: "UnresolvedPage",
    getQuartzComponents() {
      return [
        Head,
        Header,
        Body,
        ...header,
        ...beforeBody,
        pageBody,
        ...afterBody,
        ...left,
        ...right,
        Footer,
      ]
    },
    async *emit(ctx, content, resources) {
      const allFiles = content.map((c) => c[1].data)

      // Normalize existing slugs to SimpleSlug so they match file.links entries (which are SimpleSlug)
      const existingSlugs = new Set(allFiles.map(f => simplifySlug(f.slug!)))

      // Collect all unresolved links
      const unresolvedLinks = new Set<FullSlug>()
      for (const file of allFiles) {
        if (file.links) {
          for (const link of file.links) {
            // links are SimpleSlug; skip existing pages and tag links
            if (!existingSlugs.has(link) && !link.toString().startsWith("tags/")) {
              unresolvedLinks.add(link as unknown as FullSlug)
            }
          }
        }
      }

      for (const unresolved of unresolvedLinks) {
        yield processUnresolvedPage(ctx, unresolved, allFiles, opts, resources)
      }
    },
    async *partialEmit(ctx, content, resources, _changeEvents) {
      const allFiles = content.map((c) => c[1].data)
      const existingSlugs = new Set(allFiles.map(f => simplifySlug(f.slug!)))

      // Rebuild all unresolved pages (diffs for backlinks are complex)
      const unresolvedLinks = new Set<FullSlug>()
      for (const file of allFiles) {
        if (file.links) {
          for (const link of file.links) {
            if (!existingSlugs.has(link) && !link.toString().startsWith("tags/")) {
              unresolvedLinks.add(link as unknown as FullSlug)
            }
          }
        }
      }

      for (const unresolved of unresolvedLinks) {
        yield processUnresolvedPage(ctx, unresolved, allFiles, opts, resources)
      }
    },
  }
}
