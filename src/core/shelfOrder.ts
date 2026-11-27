// Port of the Apple app's ShelfOrder.swift.

/**
 * The order of the home shelves the user set in settings, as shelf ids. Which shelves exist
 * depends on the server (one «Недавно добавлено» per library), so the saved order is merged with
 * the current default instead of replacing it.
 */
export const ShelfOrder = {
  /**
   * `saved` for the shelves that exist now (`defaults`, in their default order). Unknown ids are
   * dropped; a shelf missing from `saved` (a new library, a new kind of shelf) goes right after the
   * shelf it follows by default, or first.
   */
  arrange(saved: string[], defaults: string[]): string[] {
    const present = new Set(defaults)
    const seen = new Set<string>()
    const result = saved.filter((id) => {
      if (!present.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
    insertMissing(defaults, result)
    return result
  },

  /**
   * What to save after the user arranged `current` (every shelf that exists now): `current` plus
   * the saved shelves that don't exist now (a library of the other server), each kept after the
   * shelf it followed before.
   */
  save(current: string[], saved: string[]): string[] {
    const result = [...new Set(current)]
    insertMissing(saved, result)
    return result
  },

  /** `current` with the shelf at `index` moved by `offset` (−1 up, +1 down), clamped to the ends. */
  move(current: string[], index: number, offset: number): string[] {
    if (index < 0 || index >= current.length) return current
    const result = [...current]
    const [id] = result.splice(index, 1)
    result.splice(Math.min(Math.max(index + offset, 0), result.length), 0, id)
    return result
  },
}

/**
 * Puts every id of `reference` that `result` lacks right after its nearest predecessor in
 * `reference` that `result` has, or first.
 */
function insertMissing(reference: string[], result: string[]) {
  reference.forEach((id, position) => {
    if (result.includes(id)) return
    let at = 0
    for (let i = position - 1; i >= 0; i--) {
      const found = result.indexOf(reference[i])
      if (found >= 0) {
        at = found + 1
        break
      }
    }
    result.splice(at, 0, id)
  })
}
