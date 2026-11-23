import { useEffect } from 'react'
import { appModel } from '../app/appModel'
import { useApp, useExplore, useOpenCatalog, useWatchlistRefresh } from '../app/hooks'
import { ExploreText } from '../app/explore'
import { catalogHubs, upcomingCaption } from '../core/plexDiscover'
import { exploreHubOrder, hubShown, useSettings } from '../settings'
import { CatalogCard, Shelf } from '../ui/cards'
import { ErrorView, Spinner } from '../ui/common'

/**
 * «Обзор»: Plex's ready-made collections, a shelf each (settings turn each off). Not on Home, so
 * they don't crowd out what is personal.
 */
export function Explore() {
  const { refreshKey } = useApp()
  const { collections, loaded, failed } = useExplore()
  const settings = useSettings()
  const openCatalog = useOpenCatalog()
  // The marks and «on the server» need the list and the library index.
  useWatchlistRefresh()

  useEffect(() => {
    void appModel.explore.load()
  }, [refreshKey])

  // In the order set in settings, the ones turned off left out.
  const shown = exploreHubOrder(settings)
    .filter((id) => hubShown(settings, id))
    .flatMap((id) => collections.filter((c) => c.hub === id))
  let body
  if (!loaded) body = <Spinner />
  else if (shown.length === 0 && failed) body = <ErrorView message={ExploreText.failed} onRetry={() => void appModel.explore.load(true)} />
  else if (shown.length === 0) body = <p className="muted page-inset">{ExploreText.empty}</p>
  else
    body = (
      <div className="shelves">
        {shown.map((c) => {
          const hub = catalogHubs.find((h) => h.id === c.hub)!
          return (
            <Shelf key={c.hub} title={hub.title}>
              {c.items.map((entry) => (
                <CatalogCard
                  key={entry.ratingKey}
                  entry={entry}
                  caption={hub.upcoming || entry.season !== undefined ? upcomingCaption(entry) : undefined}
                  onOpen={() => openCatalog(entry)}
                />
              ))}
            </Shelf>
          )
        })}
      </div>
    )
  return (
    <div className="explore">
      <h1 className="page-inset page-title">Обзор</h1>
      {body}
    </div>
  )
}
