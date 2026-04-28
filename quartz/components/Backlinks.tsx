import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/backlinks.scss"
import { resolveRelative, simplifySlug } from "../util/path"
import { i18n } from "../i18n"
import { classNames } from "../util/lang"

interface BacklinksOptions {
  hideWhenEmpty: boolean
}

const defaultOptions: BacklinksOptions = {
  hideWhenEmpty: true,
}

export default ((opts?: Partial<BacklinksOptions>) => {
  const options: BacklinksOptions = { ...defaultOptions, ...opts }

  const Backlinks: QuartzComponent = ({
    fileData,
    allFiles,
    displayClass,
    cfg,
  }: QuartzComponentProps) => {
    const slug = simplifySlug(fileData.slug!)
    const backlinkFiles = allFiles.filter((file) => file.links?.includes(slug))

    if (options.hideWhenEmpty && backlinkFiles.length === 0) {
      return null
    }

    return (
      <div class={classNames(displayClass, "backlinks")}>
        <h3>{i18n(cfg.locale).components.backlinks.title}</h3>
        {backlinkFiles.length > 0 ? (
          <div class="backlink-list">
            {backlinkFiles.map((f) => {
              const contexts = f.linkContexts?.[slug] ?? []
              const href = resolveRelative(fileData.slug!, f.slug!)
              return (
                <div class="backlink-item">
                  <a href={href} class="internal backlink-source">
                    {f.frontmatter?.title ?? f.slug}
                  </a>
                  {contexts.length > 0 ? (
                    <div class="backlink-contexts">
                      {contexts.map((ctx) => (
                        <div
                          class="backlink-context"
                          dangerouslySetInnerHTML={{ __html: ctx }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <p class="backlinks-empty">{i18n(cfg.locale).components.backlinks.noBacklinksFound}</p>
        )}
      </div>
    )
  }

  Backlinks.css = style

  return Backlinks
}) satisfies QuartzComponentConstructor
